import { describe, expect, it } from "vitest";
import {
  buildVEventIcs,
  DEFAULT_ALARM_MINUTES_BEFORE,
  defaultEventEnd,
  escapeIcsText,
  formatAlarmTrigger,
  formatIcsLocalDateTime,
  parseAlarmTriggerMinutes,
  parseFirstVEvent,
  replaceValarmsInIcs,
  resolveAlarmMinutes,
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

describe("formatAlarmTrigger / parseAlarmTriggerMinutes", () => {
  it("formats common offsets", () => {
    expect(formatAlarmTrigger(15)).toBe("-PT15M");
    expect(formatAlarmTrigger(60)).toBe("-PT1H");
    expect(formatAlarmTrigger(90)).toBe("-PT1H30M");
  });

  it("parses relative before-start triggers", () => {
    expect(parseAlarmTriggerMinutes("-PT15M")).toBe(15);
    expect(parseAlarmTriggerMinutes("-PT1H")).toBe(60);
    expect(parseAlarmTriggerMinutes("-PT1H30M")).toBe(90);
    expect(parseAlarmTriggerMinutes("-P1DT2H")).toBe(1560);
  });

  it("rejects absolute and positive triggers", () => {
    expect(parseAlarmTriggerMinutes("20240601T150000Z")).toBeNull();
    expect(parseAlarmTriggerMinutes("PT15M")).toBeNull();
    expect(parseAlarmTriggerMinutes("+PT15M")).toBeNull();
  });
});

describe("resolveAlarmMinutes", () => {
  it("prefers explicit, then existing, then defaults", () => {
    expect(resolveAlarmMinutes([30])).toEqual([30]);
    expect(resolveAlarmMinutes([])).toEqual([]);
    expect(resolveAlarmMinutes(undefined, [5])).toEqual([5]);
    expect(resolveAlarmMinutes(undefined, null)).toEqual([
      ...DEFAULT_ALARM_MINUTES_BEFORE,
    ]);
    expect(resolveAlarmMinutes(undefined)).toEqual([
      ...DEFAULT_ALARM_MINUTES_BEFORE,
    ]);
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

  it("uses custom alarm minutes", () => {
    const start = new Date("2024-06-01T20:00:00.000Z");
    const ics = buildVEventIcs({
      uid: "evt-3",
      title: "Custom",
      start,
      end: defaultEventEnd(start),
      timeZone: "America/Chicago",
      alarmMinutesBefore: [30, 120],
    });
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics).toContain("TRIGGER:-PT2H");
    expect(ics).not.toContain("TRIGGER:-PT15M");
  });

  it("omits VALARMs when alarm list is empty", () => {
    const start = new Date("2024-06-01T20:00:00.000Z");
    const ics = buildVEventIcs({
      uid: "evt-4",
      title: "Silent",
      start,
      end: defaultEventEnd(start),
      timeZone: "America/Chicago",
      alarmMinutesBefore: [],
    });
    expect(ics).not.toContain("BEGIN:VALARM");
    expect(ics).not.toContain("TRIGGER:");
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
    expect(parsed?.alarmMinutesBefore).toEqual([]);
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

  it("parses VALARM trigger minutes and skips RELATED=END", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:alarm-1",
      "SUMMARY:Meet",
      "DTSTART;TZID=America/Chicago:20240601T150000",
      "DTEND;TZID=America/Chicago:20240601T153000",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Reminder",
      "TRIGGER:-PT30M",
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Reminder",
      "TRIGGER:-PT2H",
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER;RELATED=END:-PT5M",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseFirstVEvent(ics);
    expect(parsed?.alarmMinutesBefore).toEqual([30, 120]);
  });

  it("round-trips custom alarms through build and parse", () => {
    const start = new Date("2024-06-01T20:00:00.000Z");
    const ics = buildVEventIcs({
      uid: "round",
      title: "Round",
      start,
      end: defaultEventEnd(start),
      timeZone: "America/Chicago",
      alarmMinutesBefore: [5, 90],
    });
    expect(parseFirstVEvent(ics)?.alarmMinutesBefore).toEqual([5, 90]);
  });
});

describe("replaceValarmsInIcs", () => {
  it("replaces alarms without touching DTSTART/DTEND", () => {
    const start = new Date("2024-06-01T20:00:00.000Z");
    const end = new Date("2024-06-01T22:00:00.000Z");
    const ics = buildVEventIcs({
      uid: "dur",
      title: "Long",
      start,
      end,
      timeZone: "America/Chicago",
      alarmMinutesBefore: [60, 15],
    });
    const next = replaceValarmsInIcs(ics, [30]);
    expect(next).toContain("TRIGGER:-PT30M");
    expect(next).not.toContain("TRIGGER:-PT1H");
    expect(next).not.toContain("TRIGGER:-PT15M");
    const startLine = ics.match(/^DTSTART.*$/m)?.[0];
    const endLine = ics.match(/^DTEND.*$/m)?.[0];
    expect(startLine).toBeTruthy();
    expect(endLine).toBeTruthy();
    expect(next).toContain(startLine!);
    expect(next).toContain(endLine!);
  });

  it("removes all VALARMs when given empty list", () => {
    const start = new Date("2024-06-01T20:00:00.000Z");
    const ics = buildVEventIcs({
      uid: "silent",
      title: "Silent",
      start,
      end: defaultEventEnd(start),
      timeZone: "America/Chicago",
    });
    const next = replaceValarmsInIcs(ics, []);
    expect(next).not.toContain("BEGIN:VALARM");
    expect(next).toContain("END:VEVENT");
  });
});
