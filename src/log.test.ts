import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const otelApi = vi.hoisted(() => ({
  getActiveSpan: vi.fn(() => ({
    spanContext: () => ({ traceId: "trace-log-1" }),
  })),
}));

vi.mock("@opentelemetry/api", () => ({
  trace: { getActiveSpan: otelApi.getActiveSpan },
}));

describe("logger", () => {
  beforeEach(() => {
    vi.resetModules();
    otelApi.getActiveSpan.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mirrors to console and emits OTEL logs with severity, body summary, and trace_id", async () => {
    const emit = vi.fn();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { bindOtelLogger, logger } = await import("./log.js");
    bindOtelLogger({ emit });

    logger.info("[test] hello", {
      component: "test",
      step: "start",
      handler: "session",
      user_text: "what time is it",
    });

    expect(logSpy).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityText: "INFO",
        body: "[test] hello handler=session step=start user_text=what time is it",
        attributes: expect.objectContaining({
          component: "test",
          step: "start",
          handler: "session",
          user_text: "what time is it",
          trace_id: "trace-log-1",
        }),
      }),
    );

    bindOtelLogger(null);
  });

  it("truncates long user text for log previews", async () => {
    const { truncateForLog, LOG_USER_TEXT_MAX } = await import("./log.js");
    const long = "a".repeat(LOG_USER_TEXT_MAX + 50);
    const preview = truncateForLog(long);
    expect(preview.length).toBe(LOG_USER_TEXT_MAX);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("includes count/from/to in Grafana body summary keys", async () => {
    const emit = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { bindOtelLogger, logger } = await import("./log.js");
    bindOtelLogger({ emit });

    logger.info("[calendar] list", {
      handler: "tool",
      tool: "calendar_list",
      step: "finish",
      result: "success",
      count: 0,
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
      duration_ms: 12,
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("count=0"),
      }),
    );
    expect(emit.mock.calls[0]?.[0]?.body).toContain("from=2026-08-01T00:00:00.000Z");
    expect(emit.mock.calls[0]?.[0]?.body).toContain("to=2026-09-01T00:00:00.000Z");

    bindOtelLogger(null);
  });
});
