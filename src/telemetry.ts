import {
  SpanStatusCode,
  type Counter,
  type Histogram,
  type Span,
} from "@opentelemetry/api";
import { initTelemetry, type TelemetryHandle } from "@crearec/otel";
import { bindOtelLogger, logger } from "./log.js";

const SERVICE_NAME = "crea-jarvis";
const SERVICE_NAMESPACE = "apps";

/** Seconds buckets for voice_session_duration_seconds (contract: not ms integers). */
export const VOICE_DURATION_BOUNDARIES_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
] as const;

export type VoiceResult = "success" | "error" | "skipped";

export type VoiceHandler =
  | "session"
  | "hello"
  | "realtime"
  | "tool"
  | "reminder_poll"
  | "http";

let telemetry: TelemetryHandle | null = null;
let sessionsTotal: Counter | null = null;
let sessionDuration: Histogram | null = null;
let errorsTotal: Counter | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function classifyError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && err.name === "TimeoutError") {
    return "timeout";
  }
  const message = errorMessage(err);
  if (/openai|api key|rate limit|realtime/i.test(message)) return "openai";
  if (/unauthorized|auth/i.test(message)) return "auth";
  if (/ENOENT|EACCES|EPERM|filesystem|no such file/i.test(message)) return "fs";
  if (/ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message)) return "network";
  return "unknown";
}

/** Bootstrap OTLP → Alloy. Safe to call once at process start. */
export function startTelemetry(): TelemetryHandle {
  if (telemetry) return telemetry;

  const tel = initTelemetry({
    kind: "app",
    serviceName: readEnv("OTEL_SERVICE_NAME") ?? SERVICE_NAME,
    serviceNamespace: readEnv("OTEL_SERVICE_NAMESPACE") ?? SERVICE_NAMESPACE,
    deploymentEnvironment: readEnv("DEPLOY_ENV") ?? "local",
    serviceVersion: readEnv("OTEL_SERVICE_VERSION"),
    endpoint: readEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
  });

  bindOtelLogger(tel.logger);
  sessionsTotal = tel.meter.createCounter("voice_sessions_total", {
    description: "Voice sessions handled (success, error, or skipped)",
  });
  sessionDuration = tel.meter.createHistogram("voice_session_duration_seconds", {
    description: "Voice session duration in seconds",
    advice: { explicitBucketBoundaries: [...VOICE_DURATION_BOUNDARIES_SECONDS] },
  });
  errorsTotal = tel.meter.createCounter("voice_errors_total", {
    description: "Explicit voice application errors",
  });

  telemetry = tel;
  return tel;
}

export function getTelemetry(): TelemetryHandle {
  if (!telemetry) {
    throw new Error("telemetry not started; call startTelemetry() first");
  }
  return telemetry;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!telemetry) return;
  bindOtelLogger(null);
  await telemetry.shutdown();
  telemetry = null;
  sessionsTotal = null;
  sessionDuration = null;
  errorsTotal = null;
}

/**
 * Record counter + histogram together on every handled voice session path
 * (success, error, or skipped).
 */
export function recordHandledSession(input: {
  result: VoiceResult;
  durationSeconds: number;
  handler: VoiceHandler;
}): void {
  try {
    sessionsTotal?.add(1, { result: input.result });
    sessionDuration?.record(input.durationSeconds, {
      result: input.result,
      handler: input.handler,
    });
  } catch (err) {
    logger.warn("[telemetry] recordHandledSession failed", {
      component: "telemetry",
      error_message: errorMessage(err),
    });
  }
}

export function recordVoiceError(input: {
  errorType: string;
  handler: VoiceHandler;
}): void {
  try {
    errorsTotal?.add(1, {
      error_type: input.errorType,
      handler: input.handler,
    });
  } catch (err) {
    logger.warn("[telemetry] recordVoiceError failed", {
      component: "telemetry",
      error_message: errorMessage(err),
    });
  }
}

/**
 * Run work inside a voice session span. Telemetry failures never block `fn`.
 */
export async function withVoiceSessionSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tel = telemetry;
  if (!tel) {
    // Telemetry optional until bootstrap; still run business logic.
    return fn({
      setAttribute() {},
      setStatus() {},
      recordException() {},
      end() {},
      spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
    } as unknown as Span);
  }

  return tel.tracer.startActiveSpan(name, async (span) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined) continue;
      span.setAttribute(key, value);
    }
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
