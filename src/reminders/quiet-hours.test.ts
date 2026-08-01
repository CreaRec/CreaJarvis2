import { describe, expect, it } from "vitest";
import { zonedLocalToUtc, zonedParts } from "../utils/time/index.js";
import { isInQuietHours, shiftOutOfQuietHours } from "./quiet-hours.js";

const TZ = "America/Chicago";

describe("isInQuietHours", () => {
  const evening = zonedLocalToUtc(TZ, 2024, 1, 15, 23, 0, 0);
  const morning = zonedLocalToUtc(TZ, 2024, 1, 15, 7, 0, 0);
  const midday = zonedLocalToUtc(TZ, 2024, 1, 15, 12, 0, 0);

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
