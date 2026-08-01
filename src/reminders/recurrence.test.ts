import { describe, expect, it } from "vitest";
import { zonedLocalToUtc, zonedParts } from "./local-time.js";
import { nextFireAt } from "./recurrence.js";

const TZ = "America/Chicago";

function local(
  year: number,
  month: number,
  day: number,
  hour = 10,
  minute = 0,
): Date {
  return zonedLocalToUtc(TZ, year, month, day, hour, minute, 0);
}

describe("nextFireAt", () => {
  it("advances daily by one local day", () => {
    const prev = local(2024, 1, 15, 10);
    const next = nextFireAt(prev, { kind: "daily" }, TZ);
    expect(next).not.toBeNull();
    expect(zonedParts(next!, TZ)).toMatchObject({
      year: 2024,
      month: 1,
      day: 16,
      hour: 10,
    });
  });

  it("advances every_n_days by n local days", () => {
    const prev = local(2024, 1, 15, 10);
    const next = nextFireAt(prev, { kind: "every_n_days", n: 3 }, TZ);
    expect(zonedParts(next!, TZ)).toMatchObject({
      day: 18,
      hour: 10,
    });
  });

  it("treats every_n_days n < 1 as 1", () => {
    const prev = local(2024, 1, 15, 10);
    const next = nextFireAt(prev, { kind: "every_n_days", n: 0 }, TZ);
    expect(zonedParts(next!, TZ).day).toBe(16);
  });

  it("advances every_n_hours by wall-clock hours", () => {
    const prev = new Date("2024-01-15T18:00:00.000Z");
    const next = nextFireAt(prev, { kind: "every_n_hours", n: 2 }, TZ);
    expect(next!.getTime()).toBe(prev.getTime() + 2 * 60 * 60 * 1000);
  });

  it("skips weekends for weekdays", () => {
    // Friday → Monday
    const friday = local(2024, 1, 19, 10); // Fri
    const next = nextFireAt(friday, { kind: "weekdays" }, TZ);
    expect(zonedParts(next!, TZ)).toMatchObject({
      year: 2024,
      month: 1,
      day: 22, // Monday
      weekday: 1,
      hour: 10,
    });
  });

  it("finds next matching weekly day", () => {
    // Monday → next Wednesday (days: Wed=3, Fri=5)
    const monday = local(2024, 1, 15, 10);
    const next = nextFireAt(monday, { kind: "weekly", days: [3, 5] }, TZ);
    expect(zonedParts(next!, TZ)).toMatchObject({
      day: 17, // Wednesday
      weekday: 3,
    });
  });

  it("returns null for weekly with empty days", () => {
    const prev = local(2024, 1, 15, 10);
    expect(nextFireAt(prev, { kind: "weekly", days: [] }, TZ)).toBeNull();
  });

  it("returns null when next fire exceeds untilDate", () => {
    const prev = local(2024, 1, 15, 10);
    expect(
      nextFireAt(prev, { kind: "daily", untilDate: "2024-01-15" }, TZ),
    ).toBeNull();
  });

  it("allows fire on untilDate inclusive", () => {
    const prev = local(2024, 1, 15, 10);
    const next = nextFireAt(
      prev,
      { kind: "daily", untilDate: "2024-01-16" },
      TZ,
    );
    expect(next).not.toBeNull();
    expect(zonedParts(next!, TZ).day).toBe(16);
  });
});
