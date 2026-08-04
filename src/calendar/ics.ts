const DEFAULT_DURATION_MS = 30 * 60 * 1000;

export const DEFAULT_EVENT_DURATION_MS = DEFAULT_DURATION_MS;

export interface BuildVEventInput {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  timeZone: string;
}

/** Escape text per RFC 5545 TEXT. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format instant as floating local date-time for TZID (YYYYMMDDTHHMMSS). */
export function formatIcsLocalDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}T${get("hour")}${get("minute")}${get("second")}`;
}

function formatIcsUtcStamp(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    "T" +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    "Z"
  );
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let remaining = line;
  chunks.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    chunks.push(" " + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return chunks.join("\r\n");
}

export function defaultEventEnd(start: Date, end?: Date): Date {
  if (end && end.getTime() > start.getTime()) return end;
  return new Date(start.getTime() + DEFAULT_DURATION_MS);
}

/** Build a single-event VCALENDAR with DISPLAY alarms at -1h and -15m. */
export function buildVEventIcs(input: BuildVEventInput): string {
  const startLocal = formatIcsLocalDateTime(input.start, input.timeZone);
  const endLocal = formatIcsLocalDateTime(input.end, input.timeZone);
  const stamp = formatIcsUtcStamp(new Date());
  const summary = escapeIcsText(input.title);
  const description =
    input.description !== undefined && input.description.length > 0
      ? escapeIcsText(input.description)
      : null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CreaJarvis//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${input.timeZone}:${startLocal}`,
    `DTEND;TZID=${input.timeZone}:${endLocal}`,
    `SUMMARY:${summary}`,
  ];
  if (description) {
    lines.push(`DESCRIPTION:${description}`);
  }
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "TRIGGER:-PT1H",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export interface ParsedCalendarEvent {
  uid: string;
  title: string;
  start: Date | null;
  end: Date | null;
  notes: string | null;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseIcsDateTime(value: string): Date | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    return new Date(
      Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!),
    );
  }
  // Floating / TZID-local without offset: treat as UTC components for listing.
  // Callers that need precise local display should use reminder link data.
  return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
}

function propValue(block: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\n)${name}(?:;[^:\\n]*)?:([^\\n]*)`, "i");
  const m = re.exec(block);
  return m?.[1]?.trim() ?? null;
}

/** Extract the first VEVENT from an iCalendar payload. */
export function parseFirstVEvent(ics: string): ParsedCalendarEvent | null {
  const unfolded = unfoldIcs(ics.replace(/\r\n/g, "\n"));
  const m = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/i.exec(unfolded);
  if (!m) return null;
  const block = m[1] ?? "";
  const uid = propValue(block, "UID");
  if (!uid) return null;
  const summary = propValue(block, "SUMMARY");
  const description = propValue(block, "DESCRIPTION");
  const dtStart = propValue(block, "DTSTART");
  const dtEnd = propValue(block, "DTEND");
  return {
    uid,
    title: summary ? unescapeIcsText(summary) : "",
    start: dtStart ? parseIcsDateTime(dtStart) : null,
    end: dtEnd ? parseIcsDateTime(dtEnd) : null,
    notes: description ? unescapeIcsText(description) : null,
  };
}
