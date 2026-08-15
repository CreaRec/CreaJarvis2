import { describe, expect, it, vi } from "vitest";
import {
  logToolCallFinished,
  toolArgsSummaryAttrs,
  toolResultSummaryAttrs,
} from "./tool-log.js";

vi.mock("../log.js", () => ({
  truncateForLog: (t: string, max = 200) =>
    t.length <= max ? t : `${t.slice(0, max - 1)}…`,
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    exception: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("tool-log", () => {
  it("summarizes range args without full payloads", () => {
    expect(
      toolArgsSummaryAttrs({
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
        limit: 30,
        status: "pending",
        secret: "should-not-appear",
      }),
    ).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
      limit: 30,
      status: "pending",
    });
  });

  it("summarizes list result count and errors", () => {
    expect(
      toolResultSummaryAttrs({
        ok: true,
        data: { events: [], count: 0 },
      }),
    ).toEqual({ result: "success", count: 0 });

    expect(
      toolResultSummaryAttrs({ ok: false, error: "CalDAV boom" }),
    ).toEqual({
      result: "error",
      error_message: "CalDAV boom",
    });
  });

  it("logs tool finish with duration and summary attrs", async () => {
    const { logger } = await import("../log.js");
    logToolCallFinished({
      message: "[agent] tool call finished",
      component: "agent",
      tool: "calendar_list",
      args: { from: "2026-08-01T00:00:00.000Z" },
      result: { ok: true, data: { count: 2 } },
      durationMs: 42,
    });
    expect(logger.info).toHaveBeenCalledWith(
      "[agent] tool call finished",
      expect.objectContaining({
        component: "agent",
        handler: "tool",
        step: "finish",
        tool: "calendar_list",
        duration_ms: 42,
        from: "2026-08-01T00:00:00.000Z",
        result: "success",
        count: 2,
      }),
    );
  });
});
