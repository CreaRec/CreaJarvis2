import { logger, truncateForLog, type LogAttributes } from "../log.js";
import type { ToolResult } from "./gateway.js";

/** Safe arg fields for Loki (no full payloads / tokens). */
export function toolArgsSummaryAttrs(args: unknown): LogAttributes {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const o = args as Record<string, unknown>;
  const out: LogAttributes = {};
  if (typeof o.from === "string" && o.from.trim()) {
    out.from = truncateForLog(o.from, 64);
  }
  if (typeof o.to === "string" && o.to.trim()) {
    out.to = truncateForLog(o.to, 64);
  }
  if (typeof o.limit === "number" && Number.isFinite(o.limit)) {
    out.limit = o.limit;
  }
  if (typeof o.status === "string" && o.status.trim()) {
    out.status = truncateForLog(o.status, 32);
  }
  return out;
}

/** Safe result fields: ok/error + list `count` when present. */
export function toolResultSummaryAttrs(result: ToolResult): LogAttributes {
  if (!result.ok) {
    return {
      result: "error",
      error_message: truncateForLog(result.error, 200),
    };
  }
  const out: LogAttributes = { result: "success" };
  const data = result.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const count = (data as { count?: unknown }).count;
    if (typeof count === "number" && Number.isFinite(count)) {
      out.count = count;
    }
  }
  return out;
}

/** Finish log for agent / realtime tool execution (args as the model passed them). */
export function logToolCallFinished(opts: {
  message: string;
  component: string;
  tool: string;
  args: unknown;
  result: ToolResult;
  durationMs: number;
}): void {
  logger.info(opts.message, {
    component: opts.component,
    handler: "tool",
    step: "finish",
    tool: opts.tool,
    duration_ms: opts.durationMs,
    ...toolArgsSummaryAttrs(opts.args),
    ...toolResultSummaryAttrs(opts.result),
  });
}
