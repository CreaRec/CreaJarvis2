import { describe, expect, it, vi } from "vitest";
import { EventStore, toPublic } from "./store.js";
import type { EventRecord } from "./types.js";
import { syncAppleCalendarToEvents } from "./apple-sync.js";
import type { ICloudCalendarClient } from "../calendar/icloud-client.js";

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  const now = new Date("2024-01-15T18:00:00.000Z");
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    uid: "uid-1",
    recurrenceId: "",
    href: "https://caldav.example/uid-1.ics",
    title: "dentist",
    startAt: new Date("2024-01-16T16:00:00.000Z"),
    endAt: new Date("2024-01-16T16:30:00.000Z"),
    timezone: "America/Chicago",
    notes: null,
    alarmMinutesBefore: [60, 15],
    recurrenceRule: null,
    isAllDay: false,
    sourceUpdatedAt: null,
    lastSeenSyncId: null,
    locationName: null,
    locationAddress: null,
    locationMapsUrl: null,
    locationLat: null,
    locationLon: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("EventStore toPublic", () => {
  it("exposes iso and local datetime pair", () => {
    const pub = toPublic(makeEvent());
    expect(pub.start_iso).toBe("2024-01-16T16:00:00.000Z");
    expect(pub.end_iso).toBe("2024-01-16T16:30:00.000Z");
    expect(pub.start_local).not.toMatch(/Z$/);
    expect(pub.end_local).not.toMatch(/Z$/);
    expect(pub.event_uid).toBe("uid-1");
    expect(pub.recurrence_id).toBeNull();
    expect(pub.is_all_day).toBe(false);
    expect(pub).not.toHaveProperty("reminder_id");
  });
});

describe("EventStore search", () => {
  it("searches event title, notes, and location by keyword", async () => {
    const row = makeEvent({
      title: "Appointment",
      locationName: "Banyan Tree Dental",
    });
    const findMany = vi.fn().mockResolvedValue([row]);
    const store = new EventStore({
      event: { findMany },
    } as never);

    const results = await store.search("dental", 5);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
        take: 15,
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Appointment");
  });
});

describe("syncAppleCalendarToEvents", () => {
  it("aborts without reconcile when snapshot incomplete", async () => {
    const calendar = {
      fetchAllEvents: vi.fn().mockResolvedValue({
        ok: true,
        data: { events: [], complete: false },
      }),
    } as unknown as ICloudCalendarClient;
    const store = {
      reconcileFromApple: vi.fn(),
    } as unknown as EventStore;
    const result = await syncAppleCalendarToEvents({
      calendar,
      store,
      defaultTimeZone: "America/Chicago",
    });
    expect(result.ok).toBe(false);
    expect(store.reconcileFromApple).not.toHaveBeenCalled();
  });

  it("reconciles active remote events and skips cancelled", async () => {
    const calendar = {
      fetchAllEvents: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          complete: true,
          events: [
            {
              uid: "a",
              href: "https://x/a.ics",
              title: "A",
              start: "2024-01-16T16:00:00.000Z",
              end: "2024-01-16T16:30:00.000Z",
              notes: null,
              location: "Cafe",
              geo: null,
              recurrenceId: "",
              recurrenceRule: null,
              isAllDay: false,
              cancelled: false,
              sourceUpdatedAt: null,
              alarmMinutesBefore: [15],
              timeZone: "America/Chicago",
            },
            {
              uid: "b",
              href: "https://x/b.ics",
              title: "B",
              start: "2024-01-17T16:00:00.000Z",
              end: "2024-01-17T16:30:00.000Z",
              notes: null,
              location: null,
              geo: null,
              recurrenceId: "",
              recurrenceRule: null,
              isAllDay: false,
              cancelled: true,
              sourceUpdatedAt: null,
              alarmMinutesBefore: [],
              timeZone: "America/Chicago",
            },
          ],
        },
      }),
    } as unknown as ICloudCalendarClient;
    const store = {
      reconcileFromApple: vi.fn().mockResolvedValue({
        created: 1,
        updated: 0,
        unchanged: 0,
        deleted: 0,
      }),
    } as unknown as EventStore;
    const result = await syncAppleCalendarToEvents({
      calendar,
      store,
      defaultTimeZone: "America/Chicago",
    });
    expect(result.ok).toBe(true);
    expect(store.reconcileFromApple).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          expect.objectContaining({
            uid: "a",
            locationAddress: "Cafe",
            locationName: null,
          }),
        ],
      }),
    );
    if (result.ok) {
      expect(result.data.created).toBe(1);
      expect(result.data.skipped).toBe(1);
    }
  });
});
