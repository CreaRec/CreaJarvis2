import { severityFromSyslogPri, type ContractSeverity } from "./severity.js";

export type ParsedSyslog = {
  severity: ContractSeverity;
  hostName: string;
  espTag: string;
  message: string;
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI color codes (ESPHome may send them if strip: false). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Parse ESPHome syslog UDP payload.
 * Format (esphome_syslog.cpp): `<PRI>Mmm dd HH:MM:SS hostname tag: message`
 * Timestamp may be `-` when SNTP is not ready.
 */
export function parseEspSyslog(raw: Uint8Array | string): ParsedSyslog | null {
  const text = stripAnsi(
    typeof raw === "string" ? raw : new TextDecoder("utf8").decode(raw),
  ).trim();
  if (!text) return null;

  const priMatch = text.match(/^<(\d{1,3})>/);
  if (!priMatch) return null;
  const pri = Number(priMatch[1]);
  if (!Number.isFinite(pri) || pri < 0 || pri > 191) return null;
  const severity = severityFromSyslogPri(pri);

  let rest = text.slice(priMatch[0].length).trimStart();

  // Optional timestamp: "Mmm dd HH:MM:SS" or "-"
  if (rest.startsWith("-")) {
    rest = rest.slice(1).trimStart();
  } else {
    const ts = rest.match(
      /^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+/,
    );
    if (ts) {
      rest = rest.slice(ts[0].length);
    }
  }

  // hostname tag: message  OR  hostname tag:message
  const bodyMatch = rest.match(/^(\S+)\s+(\S+):\s?(.*)$/s);
  if (!bodyMatch) {
    // Fallback: treat remainder as message with unknown host/tag
    if (!rest) return null;
    return {
      severity,
      hostName: "unknown",
      espTag: "unknown",
      message: rest,
    };
  }

  return {
    severity,
    hostName: bodyMatch[1],
    espTag: bodyMatch[2],
    message: bodyMatch[3],
  };
}
