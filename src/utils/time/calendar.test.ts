import { describe, expect, it } from "vitest";
import {
  addLocalDateDays,
  dayEndUtc,
  dayStartUtc,
  isValidLocalDate,
  parseLocalDate,
  todayLocalDate,
} from "./calendar.js";

const TZ = "America/Chicago";

describe("parseLocalDate / isValidLocalDate", () => {
  it("parses valid YYYY-MM-DD", () => {
    expect(parseLocalDate("2024-06-15")).toEqual({
      year: 2024,
      month: 6,
      day: 15,
    });
    expect(isValidLocalDate("2024-06-15")).toBe(true);
  });

  it("rejects invalid strings and impossible dates", () => {
    expect(parseLocalDate("06-15-2024")).toBeNull();
    expect(parseLocalDate("2024-13-01")).toBeNull();
    expect(parseLocalDate("2024-02-30")).toBeNull();
    expect(isValidLocalDate("nope")).toBe(false);
  });
});

describe("todayLocalDate", () => {
  it("returns civil date in timezone", () => {
    const d = new Date("2024-01-15T23:30:00.000Z");
    expect(todayLocalDate(TZ, d)).toBe("2024-01-15");
  });
});

describe("addLocalDateDays", () => {
  it("adds days across month boundary", () => {
    expect(addLocalDateDays("2024-01-31", TZ, 1)).toBe("2024-02-01");
    expect(addLocalDateDays("2024-01-15", TZ, -1)).toBe("2024-01-14");
  });
});

describe("dayStartUtc / dayEndUtc", () => {
  it("bounds a Chicago winter day", () => {
    const start = dayStartUtc("2024-01-15", TZ);
    const end = dayEndUtc("2024-01-15", TZ);
    expect(todayLocalDate(TZ, start)).toBe("2024-01-15");
    expect(todayLocalDate(TZ, new Date(end.getTime() - 1))).toBe("2024-01-15");
    expect(todayLocalDate(TZ, end)).toBe("2024-01-16");
  });
});
