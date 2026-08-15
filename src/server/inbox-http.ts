import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { AttachmentStore } from "../attachments/types.js";
import { refreshAttachmentStorageMetrics } from "../attachments/storage-metrics.js";
import { logger } from "../log.js";
import { classifyError } from "../telemetry.js";

const MAX_USER_ID_CHARS = 64;

const userIdSchema = z.string().trim().min(1).max(MAX_USER_ID_CHARS);

export interface InboxHttpDeps {
  store: AttachmentStore;
  tokensEqual: (a: string, b: string) => boolean;
  gatewayToken: string;
  extractBearer: (req: IncomingMessage) => string | null;
  readJsonBody: (req: IncomingMessage) => Promise<unknown>;
  maxFileBytes: number;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function requireBearer(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InboxHttpDeps,
): boolean {
  const provided = deps.extractBearer(req);
  if (!provided || !deps.tokensEqual(provided, deps.gatewayToken)) {
    json(res, 401, { ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

async function readBodyLimited(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`Body too large (max ${maxBytes} bytes)`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function handleInboxAddHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InboxHttpDeps,
): Promise<void> {
  if (!requireBearer(req, res, deps)) return;

  const userId = userIdSchema.safeParse(req.headers["x-jarvis-user-id"]);
  const filename = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .safeParse(req.headers["x-jarvis-filename"]);
  const mimeType = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .safeParse(
      req.headers["x-jarvis-mime-type"] ??
        req.headers["content-type"] ??
        "application/octet-stream",
    );

  if (!userId.success || !filename.success || !mimeType.success) {
    json(res, 400, {
      ok: false,
      error: "Invalid headers: X-Jarvis-User-Id, X-Jarvis-Filename required",
    });
    return;
  }

  try {
    const bytes = await readBodyLimited(req, deps.maxFileBytes);
    if (bytes.length === 0) {
      json(res, 400, { ok: false, error: "Empty body" });
      return;
    }
    const status = await deps.store.add(
      userId.data,
      bytes,
      filename.data,
      mimeType.data.split(";")[0]!.trim(),
    );
    await refreshAttachmentStorageMetrics(deps.store);
    logger.info("[http] inbox add", {
      component: "core",
      handler: "http",
      step: "inbox_add",
      result: "success",
      attachment_count: status.count,
    });
    json(res, 200, {
      ok: true,
      count: status.count,
      totalBytes: status.totalBytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      /too large|full|exceeded|Empty|Invalid/i.test(message) ? 400 : 500;
    logger.exception("[http] inbox add failed", err, {
      component: "core",
      handler: "http",
      step: "inbox_add",
      result: "error",
      error_type: classifyError(err),
    });
    json(res, status, { ok: false, error: message });
  }
}

export async function handleInboxStatusHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InboxHttpDeps,
): Promise<void> {
  if (!requireBearer(req, res, deps)) return;
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const userId = userIdSchema.safeParse(url.searchParams.get("userId"));
    if (!userId.success) {
      json(res, 400, { ok: false, error: "userId required" });
      return;
    }
    const status = await deps.store.status(userId.data);
    json(res, 200, {
      ok: true,
      count: status.count,
      totalBytes: status.totalBytes,
    });
  } catch (err) {
    logger.exception("[http] inbox status failed", err, {
      component: "core",
      handler: "http",
      step: "inbox_status",
      result: "error",
      error_type: classifyError(err),
    });
    json(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleInboxClearHttp(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InboxHttpDeps,
): Promise<void> {
  if (!requireBearer(req, res, deps)) return;
  try {
    const raw = await deps.readJsonBody(req);
    const parsed = z
      .object({ userId: userIdSchema })
      .safeParse(raw);
    if (!parsed.success) {
      json(res, 400, { ok: false, error: "userId required" });
      return;
    }
    await deps.store.clearPending(parsed.data.userId);
    await refreshAttachmentStorageMetrics(deps.store);
    logger.info("[http] inbox clear", {
      component: "core",
      handler: "http",
      step: "inbox_clear",
      result: "success",
    });
    json(res, 200, { ok: true });
  } catch (err) {
    logger.exception("[http] inbox clear failed", err, {
      component: "core",
      handler: "http",
      step: "inbox_clear",
      result: "error",
      error_type: classifyError(err),
    });
    json(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
