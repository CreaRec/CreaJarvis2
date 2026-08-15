import { describe, expect, it } from "vitest";
import {
  addDaysLocal,
  fixedUtcOffsetMinutes,
  localDateString,
  zonedLocalToUtc,
  zonedParts,
} from "./zoned.js";

const TZ = "America/Chicago";

describe("fixedUtcOffsetMinutes", () => {
  it("parses Apple GMT-HHMM and UTC±HH:MM labels", () => {
    expect(fixedUtcOffsetMinutes("GMT-0500")).toBe(-300);
    expect(fixedUtcOffsetMinutes("GMT+0530")).toBe(330);
    expect(fixedUtcOffsetMinutes("UTC-05:00")).toBe(-300);
    expect(fixedUtcOffsetMinutes("+0530")).toBe(330);
    expect(fixedUtcOffsetMinutes("GMT-5")).toBe(-300);
  });

  it("returns null for IANA names", () => {
    expect(fixedUtcOffsetMinutes("America/Chicago")).toBeNull();
    expect(fixedUtcOffsetMinutes("UTC")).toBeNull();
  });
});

describe("zonedParts", () => {
  it("returns civil parts in the given timezone", () => {
    const utc = new Date("2024-01-15T20:30:00.000Z");
    const parts = zonedParts(utc, TZ);
    expect(parts).toMatchObject({
      year: 2024,
      month: 1,
      day: 15,
      hour: 14,
      minute: 30,
      second: 0,
      weekday: 1,
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

  it("accepts Apple GMT-0500 fixed offset without throwing", () => {
    const utc = zonedLocalToUtc("GMT-0500", 2024, 6, 1, 15, 0, 0);
    expect(utc.toISOString()).toBe("2024-06-01T20:00:00.000Z");
    expect(zonedParts(utc, "GMT-0500")).toMatchObject({
      year: 2024,
      month: 6,
      day: 1,
      hour: 15,
      minute: 0,
    });
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

describe("localDateString", () => {
  it("formats YYYY-MM-DD in the zone", () => {
    const utc = new Date("2024-01-16T03:00:00.000Z");
    expect(localDateString(utc, TZ)).toBe("2024-01-15");
  });
});
