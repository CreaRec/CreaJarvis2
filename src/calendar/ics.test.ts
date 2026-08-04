import { describe, expect, it } from "vitest";
import {
  buildVEventIcs,
  defaultEventEnd,
  escapeIcsText,
  formatIcsLocalDateTime,
  parseFirstVEvent,
} from "./ics.js";

describe("escapeIcsText", () => {
  it("escapes special characters", () => {
    expect(escapeIcsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });
});

describe("defaultEventEnd", () => {
  it("defaults to start + 30 minutes", () => {
    const start = new Date("2024-06-01T15:00:00.000Z");
    expect(defaultEventEnd(start).toISOString()).toBe(
      "2024-06-01T15:30:00.000Z",
    );
  });

  it("keeps explicit end when after start", () => {
    const start = new Date("2024-06-01T15:00:00.000Z");
    const end = new Date("2024-06-01T16:00:00.000Z");
    expect(defaultEventEnd(start, end)).toBe(end);
  });
});

describe("buildVEventIcs", () => {
  it("includes UID, TZID times, summary escape, and both VALARMs", () => {
    const start = new Date("2024-06-01T20:00:00.000Z");
    const end = defaultEventEnd(start);
    const ics = buildVEventIcs({
      uid: "evt-1",
      title: "Meet; now",
      start,
      end,
      description: "note",
      timeZone: "America/Chicago",
    });
    expect(ics).toContain("UID:evt-1");
    expect(ics).toContain("SUMMARY:Meet\\; now");
    expect(ics).toContain("DESCRIPTION:note");
    expect(ics).toContain("TRIGGER:-PT1H");
    expect(ics).toContain("TRIGGER:-PT15M");
    expect(ics).toContain("DTSTART;TZID=America/Chicago:");
    expect(ics).toContain("DTEND;TZID=America/Chicago:");
    const localStart = formatIcsLocalDateTime(start, "America/Chicago");
    expect(ics).toContain(`DTSTART;TZID=America/Chicago:${localStart}`);
  });

  it("includes LOCATION and GEO when provided", () => {
    const start = new Date("2024-06-01T20:00:00.000Z");
    const ics = buildVEventIcs({
      uid: "evt-2",
      title: "Coffee",
      start,
      end: defaultEventEnd(start),
      description: "https://maps.google.com/?cid=1",
      location: "123 Lamar Blvd, Austin, TX",
      geo: { lat: 30.27, lon: -97.74 },
      timeZone: "America/Chicago",
    });
    expect(ics).toContain("LOCATION:123 Lamar Blvd\\, Austin\\, TX");
    expect(ics).toContain("GEO:30.27;-97.74");
    expect(ics).toContain("DESCRIPTION:https://maps.google.com/?cid=1");
  });
});

describe("parseFirstVEvent", () => {
  it("parses UID summary and datetimes", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:abc",
      "SUMMARY:Hello\\, world",
      "DTSTART;TZID=America/Chicago:20240601T150000",
      "DTEND;TZID=America/Chicago:20240601T153000",
      "DESCRIPTION:x",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseFirstVEvent(ics);
    expect(parsed?.uid).toBe("abc");
    expect(parsed?.title).toBe("Hello, world");
    expect(parsed?.notes).toBe("x");
    expect(parsed?.location).toBeNull();
    expect(parsed?.geo).toBeNull();
    expect(parsed?.start?.toISOString()).toBe("2024-06-01T15:00:00.000Z");
    expect(parsed?.end?.toISOString()).toBe("2024-06-01T15:30:00.000Z");
  });

  it("parses LOCATION and GEO", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:loc-1",
      "SUMMARY:Coffee",
      "DTSTART;TZID=America/Chicago:20240601T150000",
      "DTEND;TZID=America/Chicago:20240601T153000",
      "LOCATION:123 Lamar Blvd\\, Austin\\, TX",
      "GEO:30.27;-97.74",
      "DESCRIPTION:https://maps.google.com/?cid=1",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseFirstVEvent(ics);
    expect(parsed?.location).toBe("123 Lamar Blvd, Austin, TX");
    expect(parsed?.geo).toEqual({ lat: 30.27, lon: -97.74 });
    expect(parsed?.notes).toBe("https://maps.google.com/?cid=1");
  });
});
