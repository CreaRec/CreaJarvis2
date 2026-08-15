import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  runAgentTurn,
  type AgentTurnAttachment,
} from "../agent/turn.js";
import type {
  AgentSessionStore,
  SessionMessage,
} from "../agent/session-store.js";
import type { AttachmentStore } from "../attachments/types.js";
import type { AttachmentDbStore } from "../attachments/db-store.js";
import { promoteInboxToArchive } from "../attachments/promote.js";
import { refreshAttachmentStorageMetrics } from "../attachments/storage-metrics.js";
import {
  deleteOpenAiFile,
  openAiFilePurposeForMime,
  uploadOpenAiFile,
} from "../openai/files.js";
import { logger, truncateForLog } from "../log.js";
import type { ToolGateway } from "../tools/gateway.js";
import {
  classifyError,
  recordHandledSession,
  recordVoiceError,
  withVoiceSessionSpan,
} from "../telemetry.js";

const MAX_TEXT_CHARS = 8_000;
const MAX_USER_ID_CHARS = 64;
const DEFAULT_ATTACHMENT_PROMPT = "Что с этими вложениями?";

const turnBodySchema = z.object({
  text: z.string().trim().max(MAX_TEXT_CHARS).optional(),
  userId: z.string().trim().min(1).max(MAX_USER_ID_CHARS).optional(),
});

const clearBodySchema = z.object({
  userId: z.string().trim().min(1).max(MAX_USER_ID_CHARS),
});

export interface AgentTurnHttpDeps {
  apiKey: string;
  model: string;
  tools: ToolGateway;
  getInstructions: () => Promise<string>;
  tokensEqual: (a: string, b: string) => boolean;
  gatewayToken: string;
  extractBearer: (req: IncomingMessage) => string | null;
  readJsonBody: (req: IncomingMessage) => Promise<unknown>;
  sessionStore?: AgentSessionStore;
  runTurn?: typeof runAgentTurn;
  attachmentStore?: AttachmentStore;
  attachmentDb?: AttachmentDbStore;
  /** Mutable turn context for attachment tools. */
  turnContext?: {
    userId?: string;
    pendingInputFiles?: AgentTurnAttachment[];
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function requireBearer(
  req: IncomingMessage,
  res: ServerResponse,
  deps: Pick<
    AgentTurnHttpDeps,
    "extractBearer" | "tokensEqual" | "gatewayToken"
  >,
): boolean {
  const provided = deps.extractBearer(req);
  if (!provided || !deps.tokensEqual(provided, deps.gatewayToken)) {
    json(res, 401, { ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

export async function handleAgentTurnHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AgentTurnHttpDeps,
): Promise<void> {
  if (!requireBearer(req, res, deps)) return;

  let raw: unknown;
  try {
    raw = await deps.readJsonBody(req);
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const parsed = turnBodySchema.safeParse(raw);
  if (!parsed.success) {
    json(res, 400, { ok: false, error: "Invalid body" });
    return;
  }

  const userId = parsed.data.userId;
  let userText = (parsed.data.text ?? "").trim();
  const started = Date.now();
  let result: "success" | "error" = "success";
  const uploadedFileIds: string[] = [];

  try {
    const text = await withVoiceSessionSpan(
      "voice.session",
      { handler: "http", step: "agent_turn" },
      async () => {
        let priorMessages: SessionMessage[] = [];
        if (userId && deps.sessionStore) {
          const loadStarted = Date.now();
          priorMessages = await deps.sessionStore.getMessages(userId);
          logger.info("[http] session load", {
            component: "core",
            handler: "http",
            step: "session_load",
            result: "success",
            duration_ms: Date.now() - loadStarted,
            message_count: priorMessages.length,
            tool_message_count: priorMessages.filter(
              (message) => message.role === "tool",
            ).length,
          });
        }

        let inboxFiles: Array<{
          filename: string;
          mimeType: string;
          bytes: Buffer;
        }> = [];
        if (userId && deps.attachmentStore) {
          inboxFiles = await deps.attachmentStore.readAll(userId);
        }

        if (!userText && inboxFiles.length === 0) {
          throw new Error("text required when inbox is empty");
        }
        if (!userText && inboxFiles.length > 0) {
          userText = DEFAULT_ATTACHMENT_PROMPT;
        }

        const attachments: AgentTurnAttachment[] = [];
        for (const file of inboxFiles) {
          const uploaded = await uploadOpenAiFile({
            apiKey: deps.apiKey,
            bytes: file.bytes,
            filename: file.filename,
            mimeType: file.mimeType,
            purpose: openAiFilePurposeForMime(file.mimeType),
          });
          uploadedFileIds.push(uploaded.id);
          attachments.push({
            fileId: uploaded.id,
            filename: file.filename,
            mimeType: file.mimeType,
          });
        }

        const sessionUserText =
          attachments.length > 0
            ? `${userText}\n[attachments: ${attachments.map((a) => a.filename).join(", ")}]`
            : userText;

        const pendingInputFiles: AgentTurnAttachment[] = [];
        if (deps.turnContext) {
          deps.turnContext.userId = userId;
          deps.turnContext.pendingInputFiles = pendingInputFiles;
        }

        const instructions = await deps.getInstructions();
        const turn = await (deps.runTurn ?? runAgentTurn)({
          apiKey: deps.apiKey,
          model: deps.model,
          instructions,
          userText,
          priorMessages,
          tools: deps.tools,
          attachments: attachments.length > 0 ? attachments : undefined,
          pendingInputFiles,
        });

        if (
          userId &&
          deps.attachmentStore &&
          deps.attachmentDb &&
          inboxFiles.length > 0
        ) {
          await promoteInboxToArchive({
            userId,
            fsStore: deps.attachmentStore,
            dbStore: deps.attachmentDb,
            apiKey: deps.apiKey,
            model: deps.model,
            inboxFiles,
          });
          await refreshAttachmentStorageMetrics(deps.attachmentStore);
        }

        if (userId && deps.sessionStore) {
          const saveStarted = Date.now();
          await deps.sessionStore.appendTurn(
            userId,
            sessionUserText,
            turn.text,
            turn.toolTranscript,
          );
          logger.info("[http] session save", {
            component: "core",
            handler: "http",
            step: "session_save",
            result: "success",
            duration_ms: Date.now() - saveStarted,
            tool_message_count: turn.toolTranscript.filter(
              (message) => message.role === "tool",
            ).length,
            attachment_count: attachments.length,
          });
        }

        return turn.text;
      },
    );

    logger.info("[http] agent turn done", {
      component: "core",
      handler: "http",
      step: "agent_turn",
      result: "success",
      duration_ms: Date.now() - started,
      user_text: truncateForLog(userText),
      attachment_count: uploadedFileIds.length,
    });
    json(res, 200, { ok: true, text });
  } catch (err) {
    result = "error";
    const errorType = classifyError(err);
    recordVoiceError({ errorType, handler: "http" });
    const message = err instanceof Error ? err.message : String(err);
    const status = /text required/i.test(message) ? 400 : 500;
    logger.exception("[http] agent turn failed", err, {
      component: "core",
      handler: "http",
      step: "agent_turn",
      result: "error",
      error_type: errorType,
      user_text: truncateForLog(userText),
    });
    json(res, status, { ok: false, error: message });
  } finally {
    for (const fileId of uploadedFileIds) {
      await deleteOpenAiFile({ apiKey: deps.apiKey, fileId }).catch(
        () => undefined,
      );
    }
    if (deps.turnContext) {
      deps.turnContext.userId = undefined;
      deps.turnContext.pendingInputFiles = undefined;
    }
    recordHandledSession({
      result,
      durationSeconds: (Date.now() - started) / 1000,
      handler: "http",
    });
  }
}

export async function handleAgentSessionClearHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AgentTurnHttpDeps,
): Promise<void> {
  if (!requireBearer(req, res, deps)) return;

  let raw: unknown;
  try {
    raw = await deps.readJsonBody(req);
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const parsed = clearBodySchema.safeParse(raw);
  if (!parsed.success) {
    json(res, 400, { ok: false, error: "Invalid body: userId required" });
    return;
  }

  if (!deps.sessionStore) {
    json(res, 503, { ok: false, error: "Session store unavailable" });
    return;
  }

  const started = Date.now();
  try {
    await deps.sessionStore.clear(parsed.data.userId);
    if (deps.attachmentStore) {
      await deps.attachmentStore.clearPending(parsed.data.userId);
      await refreshAttachmentStorageMetrics(deps.attachmentStore);
    }
    logger.info("[http] session clear", {
      component: "core",
      handler: "http",
      step: "session_clear",
      result: "success",
      duration_ms: Date.now() - started,
    });
    json(res, 200, { ok: true });
  } catch (err) {
    const errorType = classifyError(err);
    logger.exception("[http] session clear failed", err, {
      component: "core",
      handler: "http",
      step: "session_clear",
      result: "error",
      error_type: errorType,
    });
    json(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}
