import { initTelemetry, type TelemetryHandle } from "@crearec/otel";
import { bindOtelLogger } from "./log.js";

let telemetry: TelemetryHandle | null = null;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function startTelemetry(): TelemetryHandle {
  if (telemetry) return telemetry;
  const tel = initTelemetry({
    kind: "bot",
    serviceName: readEnv("OTEL_SERVICE_NAME") ?? "crea-jarvis-telegram",
    serviceNamespace: readEnv("OTEL_SERVICE_NAMESPACE") ?? "apps",
    deploymentEnvironment: readEnv("DEPLOY_ENV") ?? "local",
    serviceVersion: readEnv("OTEL_SERVICE_VERSION"),
    endpoint: readEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
  });
  bindOtelLogger(tel.logger);
  telemetry = tel;
  return tel;
}

export async function shutdownTelemetry(): Promise<void> {
  if (!telemetry) return;
  bindOtelLogger(null);
  await telemetry.shutdown();
  telemetry = null;
}

export function classifyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/openai|api key|rate limit|whisper|speech/i.test(message)) return "openai";
  if (/unauthorized|auth/i.test(message)) return "auth";
  if (/ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message)) {
    return "network";
  }
  return "unknown";
}
