import dgram from "node:dgram";
import { initTelemetry } from "@crearec/otel";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { ContractSeverity } from "./severity.js";
import { parseEspSyslog } from "./syslog.js";

function readEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim();
}

function severityNumber(severity: ContractSeverity): number {
  switch (severity) {
    case "DEBUG":
      return SeverityNumber.DEBUG;
    case "WARN":
      return SeverityNumber.WARN;
    case "ERROR":
      return SeverityNumber.ERROR;
    default:
      return SeverityNumber.INFO;
  }
}

function emitSafe(
  emit: (record: {
    severityText: string;
    severityNumber?: number;
    body: string;
    attributes?: Record<string, string>;
  }) => void,
  record: {
    severityText: ContractSeverity;
    body: string;
    attributes?: Record<string, string>;
  },
): void {
  try {
    emit({
      severityText: record.severityText,
      severityNumber: severityNumber(record.severityText),
      body: record.body,
      attributes: record.attributes,
    });
  } catch (err) {
    console.warn(
      "[esp-syslog-bridge] otel emit failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function main(): Promise<void> {
  const port = Number(readEnv("SYSLOG_UDP_PORT", "1514"));
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`invalid SYSLOG_UDP_PORT: ${process.env.SYSLOG_UDP_PORT}`);
  }

  const tel = initTelemetry({
    kind: "app",
    serviceName: readEnv("OTEL_SERVICE_NAME", "crea-jarvis-client"),
    serviceNamespace: readEnv("OTEL_SERVICE_NAMESPACE", "apps"),
    deploymentEnvironment: readEnv("DEPLOY_ENV", "local"),
    serviceVersion: readEnv("OTEL_SERVICE_VERSION"),
    endpoint: readEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
  });

  const socket = dgram.createSocket("udp4");

  socket.on("message", (msg) => {
    const parsed = parseEspSyslog(msg);
    if (!parsed) {
      emitSafe((r) => tel.logger.emit(r), {
        severityText: "WARN",
        body: "[esp-syslog-bridge] drop unparseable syslog packet",
        attributes: {
          component: "esp-syslog-bridge",
          packet_bytes: String(msg.length),
        },
      });
      return;
    }

    emitSafe((r) => tel.logger.emit(r), {
      severityText: parsed.severity,
      body: parsed.message,
      attributes: {
        component: "esp",
        host_name: parsed.hostName,
        esp_tag: parsed.espTag,
      },
    });
  });

  socket.on("error", (err) => {
    console.error("[esp-syslog-bridge] socket error", err.message);
    emitSafe((r) => tel.logger.emit(r), {
      severityText: "ERROR",
      body: "[esp-syslog-bridge] udp socket error",
      attributes: {
        component: "esp-syslog-bridge",
        error_message: err.message,
      },
    });
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(port, "0.0.0.0", () => {
      socket.off("error", reject);
      resolve();
    });
  });

  emitSafe((r) => tel.logger.emit(r), {
    severityText: "INFO",
    body: "[esp-syslog-bridge] listening",
    attributes: {
      component: "esp-syslog-bridge",
      port: String(port),
    },
  });
  console.log(`[esp-syslog-bridge] listening udp/${port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[esp-syslog-bridge] shutdown ${signal}`);
    await new Promise<void>((resolve) => {
      socket.close(() => resolve());
    });
    await tel.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[esp-syslog-bridge] fatal", err);
  process.exit(1);
});
