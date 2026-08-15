import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const otel = vi.hoisted(() => {
  const span = {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
    spanContext: () => ({ traceId: "trace-abc", spanId: "span-1", traceFlags: 1 }),
  };
  type FakeSpan = typeof span;
  const sessionsTotal = { add: vi.fn() };
  const sessionDuration = { record: vi.fn() };
  const errorsTotal = { add: vi.fn() };
  const logger = { emit: vi.fn() };
  const meter = {
    createCounter: vi.fn((name: string) => {
      if (name === "voice_sessions_total") return sessionsTotal;
      if (name === "voice_errors_total") return errorsTotal;
      return { add: vi.fn() };
    }),
    createHistogram: vi.fn(() => sessionDuration),
  };
  const tracer = {
    startActiveSpan: vi.fn(async (_name: string, fn: (s: FakeSpan) => Promise<unknown>) =>
      fn(span),
    ),
  };
  return {
    span,
    sessionsTotal,
    sessionDuration,
    errorsTotal,
    logger,
    meter,
    tracer,
    initTelemetry: vi.fn(() => ({
      kind: "app" as const,
      serviceName: "crea-jarvis",
      serviceNamespace: "apps",
      tracer,
      meter,
      logger,
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock("@crearec/otel", () => ({
  initTelemetry: otel.initTelemetry,
}));

describe("telemetry", () => {
  beforeEach(() => {
    vi.resetModules();
    otel.sessionsTotal.add.mockClear();
    otel.sessionDuration.record.mockClear();
    otel.errorsTotal.add.mockClear();
    otel.logger.emit.mockClear();
    otel.span.setAttribute.mockClear();
    otel.span.setStatus.mockClear();
    otel.span.recordException.mockClear();
    otel.span.end.mockClear();
    otel.tracer.startActiveSpan.mockClear();
    otel.initTelemetry.mockClear();
    otel.meter.createCounter.mockClear();
    otel.meter.createHistogram.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts app telemetry with contract defaults", async () => {
    const { startTelemetry, shutdownTelemetry } = await import("./telemetry.js");
    const tel = startTelemetry();
    expect(otel.initTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "app",
        serviceName: "crea-jarvis",
        serviceNamespace: "apps",
      }),
    );
    expect(tel.serviceName).toBe("crea-jarvis");
    expect(otel.meter.createCounter).toHaveBeenCalledWith(
      "voice_sessions_total",
      expect.any(Object),
    );
    expect(otel.meter.createHistogram).toHaveBeenCalledWith(
      "voice_session_duration_seconds",
      expect.any(Object),
    );
    await shutdownTelemetry();
  });

  it("records counter and histogram together on handled session", async () => {
    const {
      startTelemetry,
      recordHandledSession,
      shutdownTelemetry,
    } = await import("./telemetry.js");
    startTelemetry();
    recordHandledSession({
      result: "success",
      durationSeconds: 1.25,
      handler: "session",
    });

    expect(otel.sessionsTotal.add).toHaveBeenCalledWith(1, { result: "success" });
    expect(otel.sessionDuration.record).toHaveBeenCalledWith(1.25, {
      result: "success",
      handler: "session",
    });
    await shutdownTelemetry();
  });

  it("records voice errors with low-cardinality labels", async () => {
    const { startTelemetry, recordVoiceError, shutdownTelemetry } =
      await import("./telemetry.js");
    startTelemetry();
    recordVoiceError({ errorType: "openai", handler: "realtime" });
    expect(otel.errorsTotal.add).toHaveBeenCalledWith(1, {
      error_type: "openai",
      handler: "realtime",
    });
    await shutdownTelemetry();
  });

  it("records telegram handler on handled session", async () => {
    const {
      startTelemetry,
      recordHandledSession,
      recordVoiceError,
      shutdownTelemetry,
    } = await import("./telemetry.js");
    startTelemetry();
    recordHandledSession({
      result: "success",
      durationSeconds: 0.5,
      handler: "telegram",
    });
    recordHandledSession({
      result: "skipped",
      durationSeconds: 0,
      handler: "telegram",
    });
    recordVoiceError({ errorType: "network", handler: "telegram" });
    expect(otel.sessionDuration.record).toHaveBeenCalledWith(0.5, {
      result: "success",
      handler: "telegram",
    });
    expect(otel.sessionDuration.record).toHaveBeenCalledWith(0, {
      result: "skipped",
      handler: "telegram",
    });
    expect(otel.errorsTotal.add).toHaveBeenCalledWith(1, {
      error_type: "network",
      handler: "telegram",
    });
    await shutdownTelemetry();
  });

  it("runs work inside a voice session span", async () => {
    const { startTelemetry, withVoiceSessionSpan, shutdownTelemetry } =
      await import("./telemetry.js");
    startTelemetry();
    const value = await withVoiceSessionSpan(
      "voice.session",
      { device_id: "desk", handler: "session" },
      async (span) => {
        span.setAttribute("ok", true);
        return 42;
      },
    );
    expect(value).toBe(42);
    expect(otel.tracer.startActiveSpan).toHaveBeenCalled();
    expect(otel.span.setAttribute).toHaveBeenCalledWith("device_id", "desk");
    expect(otel.span.end).toHaveBeenCalled();
    await shutdownTelemetry();
  });

  it("is idempotent across start/shutdown", async () => {
    const { startTelemetry, shutdownTelemetry, getTelemetry } =
      await import("./telemetry.js");
    const first = startTelemetry();
    const second = startTelemetry();
    expect(first).toBe(second);
    expect(getTelemetry()).toBe(first);
    await shutdownTelemetry();
    await shutdownTelemetry();
    expect(otel.initTelemetry).toHaveBeenCalledTimes(1);
  });
});
