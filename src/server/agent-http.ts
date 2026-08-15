import { z } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import { runAgentTurn } from "../agent/turn.js";
import { logger, truncateForLog } from "../log.js";
import type { ToolGateway } from "../tools/gateway.js";
import {
  classifyError,
  recordHandledSession,
  recordVoiceError,
  withVoiceSessionSpan,
} from "../telemetry.js";

const MAX_TEXT_CHARS = 8_000;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
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
  runTurn?: typeof runAgentTurn;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function handleAgentTurnHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AgentTurnHttpDeps,
): Promise<void> {
  const provided = deps.extractBearer(req);
  if (!provided || !deps.tokensEqual(provided, deps.gatewayToken)) {
    json(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  let raw: unknown;
  try {
    raw = await deps.readJsonBody(req);
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    json(res, 400, { ok: false, error: "Invalid body: text required" });
    return;
  }

  const userText = parsed.data.text;
  const started = Date.now();
  let result: "success" | "error" = "success";

  try {
    const text = await withVoiceSessionSpan(
      "voice.session",
      { handler: "http", step: "agent_turn" },
      async () => {
        const instructions = await deps.getInstructions();
        const turn = await (deps.runTurn ?? runAgentTurn)({
          apiKey: deps.apiKey,
          model: deps.model,
          instructions,
          userText,
          tools: deps.tools,
        });
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

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}
