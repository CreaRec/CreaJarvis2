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
    const asUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
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

export function localDateString(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
