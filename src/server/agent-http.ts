import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runAgentTurn } from "../agent/turn.js";
import type { AgentSessionStore } from "../agent/session-store.js";
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

const turnBodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
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
    json(res, 400, { ok: false, error: "Invalid body: text required" });
    return;
  }

  const userText = parsed.data.text;
  const userId = parsed.data.userId;
  const started = Date.now();
  let result: "success" | "error" = "success";

  try {
    const text = await withVoiceSessionSpan(
      "voice.session",
      { handler: "http", step: "agent_turn" },
      async () => {
        let priorMessages: Array<{
          role: "user" | "assistant";
          content: string;
        }> = [];
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
          });
        }

        const instructions = await deps.getInstructions();
        const turn = await (deps.runTurn ?? runAgentTurn)({
          apiKey: deps.apiKey,
          model: deps.model,
          instructions,
          userText,
          priorMessages,
          tools: deps.tools,
        });

        if (userId && deps.sessionStore) {
          const saveStarted = Date.now();
          await deps.sessionStore.appendTurn(userId, userText, turn.text);
          logger.info("[http] session save", {
            component: "core",
            handler: "http",
            step: "session_save",
            result: "success",
            duration_ms: Date.now() - saveStarted,
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
    });
    json(res, 200, { ok: true, text });
  } catch (err) {
    result = "error";
    const errorType = classifyError(err);
    recordVoiceError({ errorType, handler: "http" });
    logger.exception("[http] agent turn failed", err, {
      component: "core",
      handler: "http",
      step: "agent_turn",
      result: "error",
      error_type: errorType,
      user_text: truncateForLog(userText),
    });
    json(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
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
