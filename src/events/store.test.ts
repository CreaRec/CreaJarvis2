import { describe, expect, it } from "vitest";
import { toPublic } from "./store.js";
import type { EventRecord } from "./types.js";

describe("EventStore toPublic", () => {
  it("exposes iso and local datetime pair", () => {
    const record: EventRecord = {
      id: "00000000-0000-4000-8000-0000000000aa",
      uid: "uid-1",
      href: "https://caldav.example/uid-1.ics",
      title: "dentist",
      startAt: new Date("2024-01-16T16:00:00.000Z"),
      endAt: new Date("2024-01-16T16:30:00.000Z"),
      timezone: "America/Chicago",
      notes: null,
      alarmMinutesBefore: [60, 15],
      locationName: null,
      locationAddress: null,
      locationMapsUrl: null,
      locationLat: null,
      locationLon: null,
      createdAt: new Date("2024-01-15T18:00:00.000Z"),
      updatedAt: new Date("2024-01-15T18:00:00.000Z"),
    };
    const pub = toPublic(record);
    expect(pub.start_iso).toBe("2024-01-16T16:00:00.000Z");
    expect(pub.end_iso).toBe("2024-01-16T16:30:00.000Z");
    expect(pub.start_local).not.toMatch(/Z$/);
    expect(pub.end_local).not.toMatch(/Z$/);
    expect(pub.event_uid).toBe("uid-1");
    expect(pub).not.toHaveProperty("reminder_id");
  });
});
