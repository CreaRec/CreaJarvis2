import { describe, expect, it } from "vitest";
import {
  addDaysLocal,
  isInQuietHours,
  localDateString,
  shiftOutOfQuietHours,
  zonedLocalToUtc,
  zonedParts,
} from "./local-time.js";

const TZ = "America/Chicago";

describe("zonedParts", () => {
  it("returns civil parts in the given timezone", () => {
    // 2024-01-15 14:30:00 CST (UTC-6)
    const utc = new Date("2024-01-15T20:30:00.000Z");
    const parts = zonedParts(utc, TZ);
    expect(parts).toMatchObject({
      year: 2024,
      month: 1,
      day: 15,
      hour: 14,
      minute: 30,
      second: 0,
      weekday: 1, // Monday
    });
  });
});

describe("zonedLocalToUtc", () => {
  it("round-trips with zonedParts", () => {
    const utc = zonedLocalToUtc(TZ, 2024, 6, 15, 10, 0, 0);
    const parts = zonedParts(utc, TZ);
    expect(parts).toMatchObject({
      year: 2024,
      month: 6,
      day: 15,
      hour: 10,
      minute: 0,
      second: 0,
    });
  });

  it("handles CST (winter) offset", () => {
    const utc = zonedLocalToUtc(TZ, 2024, 1, 15, 12, 0, 0);
    expect(utc.toISOString()).toBe("2024-01-15T18:00:00.000Z");
  });

  it("handles CDT (summer) offset", () => {
    const utc = zonedLocalToUtc(TZ, 2024, 7, 15, 12, 0, 0);
    expect(utc.toISOString()).toBe("2024-07-15T17:00:00.000Z");
  });
});

describe("addDaysLocal", () => {
  it("preserves local clock time across a normal day", () => {
    const start = zonedLocalToUtc(TZ, 2024, 1, 15, 9, 30, 0);
    const next = addDaysLocal(start, TZ, 1);
    expect(zonedParts(next, TZ)).toMatchObject({
      year: 2024,
      month: 1,
      day: 16,
      hour: 9,
      minute: 30,
    });
  });

  it("preserves local clock time across spring DST spring-forward", () => {
    // 2024-03-09 → 2024-03-10 crosses US DST start (2am → 3am)
    const start = zonedLocalToUtc(TZ, 2024, 3, 9, 10, 0, 0);
    const next = addDaysLocal(start, TZ, 1);
    expect(zonedParts(next, TZ)).toMatchObject({
      year: 2024,
      month: 3,
      day: 10,
      hour: 10,
      minute: 0,
    });
  });

  it("preserves local clock time across fall DST fall-back", () => {
    // 2024-11-02 → 2024-11-03 crosses US DST end
    const start = zonedLocalToUtc(TZ, 2024, 11, 2, 10, 0, 0);
    const next = addDaysLocal(start, TZ, 1);
    expect(zonedParts(next, TZ)).toMatchObject({
      year: 2024,
      month: 11,
      day: 3,
      hour: 10,
      minute: 0,
    });
  });
});

describe("isInQuietHours", () => {
  const evening = zonedLocalToUtc(TZ, 2024, 1, 15, 23, 0, 0); // 23:00
  const morning = zonedLocalToUtc(TZ, 2024, 1, 15, 7, 0, 0); // 07:00
  const midday = zonedLocalToUtc(TZ, 2024, 1, 15, 12, 0, 0); // 12:00

  it("detects wrap-midnight quiet window (22→8)", () => {
    expect(isInQuietHours(evening, TZ, 22, 8)).toBe(true);
    expect(isInQuietHours(morning, TZ, 22, 8)).toBe(true);
    expect(isInQuietHours(midday, TZ, 22, 8)).toBe(false);
  });

  it("detects same-day quiet window (13→15)", () => {
    expect(isInQuietHours(midday, TZ, 13, 15)).toBe(false);
    const quiet = zonedLocalToUtc(TZ, 2024, 1, 15, 14, 0, 0);
    expect(isInQuietHours(quiet, TZ, 13, 15)).toBe(true);
  });

  it("returns false when start equals end (disabled)", () => {
    expect(isInQuietHours(evening, TZ, 22, 22)).toBe(false);
  });
});

describe("shiftOutOfQuietHours", () => {
  const config = { REMINDER_QUIET_START: 22, REMINDER_QUIET_END: 8 };

  it("leaves non-quiet times unchanged", () => {
    const midday = zonedLocalToUtc(TZ, 2024, 1, 15, 12, 0, 0);
    expect(shiftOutOfQuietHours(midday, TZ, config).getTime()).toBe(
      midday.getTime(),
    );
  });

  it("shifts evening quiet to next morning quiet-end", () => {
    const evening = zonedLocalToUtc(TZ, 2024, 1, 15, 23, 0, 0);
    const shifted = shiftOutOfQuietHours(evening, TZ, config);
    expect(zonedParts(shifted, TZ)).toMatchObject({
      year: 2024,
      month: 1,
      day: 16,
      hour: 8,
      minute: 0,
    });
  });

  it("shifts early-morning quiet to same-day quiet-end", () => {
    const early = zonedLocalToUtc(TZ, 2024, 1, 15, 3, 0, 0);
    const shifted = shiftOutOfQuietHours(early, TZ, config);
    expect(zonedParts(shifted, TZ)).toMatchObject({
      year: 2024,
      month: 1,
      day: 15,
      hour: 8,
      minute: 0,
    });
  });
});

describe("localDateString", () => {
  it("formats YYYY-MM-DD in the zone", () => {
    // Late UTC evening is still previous calendar day in Chicago winter
    const utc = new Date("2024-01-16T03:00:00.000Z"); // 21:00 CST on Jan 15
    expect(localDateString(utc, TZ)).toBe("2024-01-15");
  });
});
