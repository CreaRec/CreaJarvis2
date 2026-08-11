/** Contract severityText values (telemetry-contract.md). */
export type ContractSeverity = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Syslog severity 0–7 (RFC 5424). */
const SYSLOG_SEVERITY_TO_CONTRACT: Record<number, ContractSeverity> = {
  0: "ERROR", // emerg
  1: "ERROR", // alert
  2: "ERROR", // crit
  3: "ERROR", // err
  4: "WARN", // warning
  5: "INFO", // notice
  6: "INFO", // informational
  7: "DEBUG", // debug
};

/** OTEL SeverityNumber (optional companion to severityText). */
export const SEVERITY_NUMBER: Record<ContractSeverity, number> = {
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
};

export function severityFromSyslogPri(pri: number): ContractSeverity {
  const severity = pri % 8;
  return SYSLOG_SEVERITY_TO_CONTRACT[severity] ?? "INFO";
}
