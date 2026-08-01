import type { AppConfig } from "../config.js";
import { addDaysLocal, zonedLocalToUtc, zonedParts } from "../utils/time/index.js";

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
