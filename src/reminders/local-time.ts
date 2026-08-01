import type { AppConfig } from "../config.js";

export function formatLocal(date: Date, timeZone: string): string {
  return date.toLocaleString("ru-RU", { timeZone });
}

/** Parts of `date` interpreted in `timeZone`. */
export function zonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1=Mon .. 7=Sun (ISO)
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday ?? "Mon"] ?? 1,
  };
}

/**
 * Build a UTC Date for a civil datetime in `timeZone`.
 * Uses iterative offset correction (no extra deps).
 */
export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    guess = new Date(guess.getTime() + (target - asUtc));
  }
  return guess;
}

export function addDaysLocal(
  date: Date,
  timeZone: string,
  days: number,
): Date {
  const p = zonedParts(date, timeZone);
  // Anchor at noon to avoid DST edge when adding days via UTC date math
  const noon = zonedLocalToUtc(timeZone, p.year, p.month, p.day, 12, 0, 0);
  const shifted = new Date(noon.getTime() + days * 24 * 60 * 60 * 1000);
  const sp = zonedParts(shifted, timeZone);
  return zonedLocalToUtc(
    timeZone,
    sp.year,
    sp.month,
    sp.day,
    p.hour,
    p.minute,
    p.second,
  );
}

export function isInQuietHours(
  date: Date,
  timeZone: string,
  quietStart: number,
  quietEnd: number,
): boolean {
  const { hour } = zonedParts(date, timeZone);
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) {
    return hour >= quietStart && hour < quietEnd;
  }
  // wraps midnight, e.g. 22 → 8
  return hour >= quietStart || hour < quietEnd;
}

/** Shift fireAt to next quiet-end local time if currently in quiet hours. */
export function shiftOutOfQuietHours(
  fireAt: Date,
  timeZone: string,
  config: Pick<AppConfig, "REMINDER_QUIET_START" | "REMINDER_QUIET_END">,
): Date {
  const start = config.REMINDER_QUIET_START;
  const end = config.REMINDER_QUIET_END;
  if (!isInQuietHours(fireAt, timeZone, start, end)) return fireAt;

  const p = zonedParts(fireAt, timeZone);
  let year = p.year;
  let month = p.month;
  let day = p.day;
  // If we're past midnight quiet (hour < end), end is today; if evening quiet, end is tomorrow
  if (p.hour >= start) {
    const next = addDaysLocal(
      zonedLocalToUtc(timeZone, year, month, day, 12, 0, 0),
      timeZone,
      1,
    );
    const np = zonedParts(next, timeZone);
    year = np.year;
    month = np.month;
    day = np.day;
  }
  return zonedLocalToUtc(timeZone, year, month, day, end, 0, 0);
}

export function localDateString(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
