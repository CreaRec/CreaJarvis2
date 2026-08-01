import {
  addDaysLocal,
  localDateString,
  zonedParts,
} from "../utils/time/index.js";
import type { Recurrence } from "./types.js";

function pastUntil(next: Date, timeZone: string, untilDate?: string): boolean {
  if (!untilDate) return false;
  return localDateString(next, timeZone) > untilDate;
}

/**
 * Compute the next fire time after `prev` for a recurrence rule.
 * Returns null when the series is exhausted (untilDate).
 */
export function nextFireAt(
  prev: Date,
  recurrence: Recurrence,
  timeZone: string,
): Date | null {
  let next: Date;

  switch (recurrence.kind) {
    case "daily":
      next = addDaysLocal(prev, timeZone, 1);
      break;
    case "every_n_days":
      next = addDaysLocal(prev, timeZone, Math.max(1, recurrence.n));
      break;
    case "every_n_hours":
      next = new Date(
        prev.getTime() + Math.max(1, recurrence.n) * 60 * 60 * 1000,
      );
      break;
    case "weekdays": {
      next = addDaysLocal(prev, timeZone, 1);
      for (let i = 0; i < 8; i++) {
        const wd = zonedParts(next, timeZone).weekday;
        if (wd >= 1 && wd <= 5) break;
        next = addDaysLocal(next, timeZone, 1);
      }
      break;
    }
    case "weekly": {
      const days = [...new Set(recurrence.days)]
        .filter((d) => d >= 1 && d <= 7)
        .sort((a, b) => a - b);
      if (days.length === 0) return null;
      next = addDaysLocal(prev, timeZone, 1);
      for (let i = 0; i < 8; i++) {
        const wd = zonedParts(next, timeZone).weekday;
        if (days.includes(wd)) break;
        next = addDaysLocal(next, timeZone, 1);
      }
      break;
    }
    default:
      return null;
  }

  if (pastUntil(next, timeZone, recurrence.untilDate)) return null;
  return next;
}
