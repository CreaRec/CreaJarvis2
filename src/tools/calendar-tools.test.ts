import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import type { ICloudCalendarClient } from "../calendar/icloud-client.js";
import type { EventRecord } from "../events/types.js";
import type { EventStore } from "../events/store.js";
import { ToolGateway } from "./gateway.js";
import { createCalendarTools } from "./calendar-tools.js";
import { logger } from "../log.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    OPENAI_API_KEY: "test",
    DATABASE_URL: "postgres://x",
    REDIS_URL: "redis://localhost:6379",
    AGENT_SESSION_TTL_SECONDS: 1800,
    AGENT_SESSION_MAX_MESSAGES: 12,
    PORT: 8787,
    MEMORY_RETRIEVER: "pgvector",
    EMBEDDING_MODEL: "text-embedding-3-small",
    EMBEDDING_DIMENSIONS: 1536,
    REALTIME_MODEL: "gpt-realtime-2.1",
    VOICE: "marin",
    VOICE_GATEWAY_URL: "ws://127.0.0.1:8787/voice",
    JARVIS_GATEWAY_TOKEN: "test-token-lan",
    BRAVE_API_KEY: "test",
    BRAVE_COUNTRY: "US",
    BRAVE_SEARCH_LANG: "ru",
    GOOGLE_PLACES_API_KEY: "test",
    USER_TIMEZONE: "America/Chicago",
    REMINDER_MORNING_HOUR: 10,
    REMINDER_AFTERNOON_HOUR: 14,
    REMINDER_EVENING_HOUR: 18,
    REMINDER_NIGHT_HOUR: 21,
    REMINDER_QUIET_START: 22,
    REMINDER_QUIET_END: 8,
    REMINDER_POLL_MS: 15000,
    JARVIS_WEATHER: "1",
    JARVIS_WEATHER_LAT: undefined,
    JARVIS_WEATHER_LON: undefined,
    JARVIS_WEATHER_PLACE: "",
    JARVIS_WEATHER_TIMEOUT: 3,
    ICLOUD_CALDAV_USERNAME: "",
    ICLOUD_CALDAV_PASSWORD: "",
    ICLOUD_CALDAV_CALENDAR_URL: "",
    AGENT_CHAT_MODEL: "gpt-4o",
    ...overrides,
  };
}

const EVENT_ID = "00000000-0000-4000-8000-0000000000aa";

function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  const now = new Date("2024-01-15T18:00:00.000Z");
  return {
    id: EVENT_ID,
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

function makeCalendar(
  overrides: Partial<ICloudCalendarClient> = {},
): ICloudCalendarClient {
  return {
    createEvent: vi.fn(),
    listEvents: vi.fn(),
    fetchAllEvents: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    ...overrides,
  };
}

function makeStore(overrides: Partial<EventStore> = {}): EventStore {
  return {
    create: vi.fn(),
    getById: vi.fn(),
    getByUid: vi.fn(),
    listByUid: vi.fn(),
    getByUids: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    reconcileFromApple: vi.fn(),
    ...overrides,
  } as unknown as EventStore;
}

function gatewayWith(
  calendar: ICloudCalendarClient,
  store: EventStore,
): ToolGateway {
  const gw = new ToolGateway();
  for (const tool of createCalendarTools({
    calendar,
    store,
    config: makeConfig(),
  })) {
    gw.register(tool);
  }
  return gw;
}

describe("createCalendarTools", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("creates standalone event in CalDAV and EventStore", async () => {
    const saved = makeEvent();
    const store = makeStore({
      create: vi.fn().mockResolvedValue(saved),
    });
    const calendar = makeCalendar({
      createEvent: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          uid: "uid-1",
          href: "https://caldav.example/uid-1.ics",
          end: new Date("2024-01-16T16:30:00.000Z"),
        },
      }),
    });
    const gw = gatewayWith(calendar, store);
    const result = await gw.execute("calendar_create_event", {
      title: "dentist",
      start: "2024-01-16T16:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        id: string;
        event_uid: string;
        start_iso: string;
        end_iso: string;
        start_local: string;
        end_local: string;
      };
      expect(data.id).toBe(EVENT_ID);
      expect(data.event_uid).toBe("uid-1");
      expect(data.start_iso).toBe("2024-01-16T16:00:00.000Z");
      expect(data.end_iso).toBe("2024-01-16T16:30:00.000Z");
      expect(data.start_local).toBeTruthy();
      expect(data.end_local).toBeTruthy();
      expect(data).not.toHaveProperty("reminder_id");
    }
    expect(calendar.createEvent).toHaveBeenCalled();
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "uid-1",
        title: "dentist",
      }),
    );
  });

  it("passes location into createEvent", async () => {
    const store = makeStore({
      create: vi.fn().mockResolvedValue(
        makeEvent({
          locationName: "Starbucks",
          locationAddress: "123 Lamar Blvd, Austin, TX",
          locationMapsUrl: "https://maps.google.com/?cid=1",
          locationLat: 30.27,
          locationLon: -97.74,
        }),
      ),
    });
    const calendar = makeCalendar({
      createEvent: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          uid: "uid-loc",
          href: "https://caldav.example/uid-loc.ics",
          end: new Date("2024-01-16T16:30:00.000Z"),
        },
      }),
    });
    const gw = gatewayWith(calendar, store);
    const result = await gw.execute("calendar_create_event", {
      title: "Coffee",
      start: "2024-01-16T16:00:00.000Z",
      location_name: "Starbucks",
      location_address: "123 Lamar Blvd, Austin, TX",
      location_maps_url: "https://maps.google.com/?cid=1",
      location_lat: 30.27,
      location_lon: -97.74,
    });
    expect(result.ok).toBe(true);
    expect(calendar.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        location: "123 Lamar Blvd, Austin, TX",
        geo: { lat: 30.27, lon: -97.74 },
        description: "https://maps.google.com/?cid=1",
      }),
    );
  });

  it("compensates with CalDAV delete when DB create fails", async () => {
    const store = makeStore({
      create: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const calendar = makeCalendar({
      createEvent: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          uid: "uid-orphan",
          href: "https://caldav.example/uid-orphan.ics",
          end: new Date("2024-01-16T16:30:00.000Z"),
        },
      }),
      deleteEvent: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
    });
    const gw = gatewayWith(calendar, store);
    const result = await gw.execute("calendar_create_event", {
      title: "x",
      start: "2024-01-16T16:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(calendar.deleteEvent).toHaveBeenCalledWith(
      "https://caldav.example/uid-orphan.ics",
    );
  });

  it("lists CalDAV events and attaches event_id for local matches", async () => {
    const store = makeStore({
      getByUids: vi.fn().mockResolvedValue([makeEvent()]),
    });
    const calendar = makeCalendar({
      listEvents: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          events: [
            {
              uid: "uid-1",
              href: "https://caldav.example/uid-1.ics",
              title: "dentist",
              start: "2024-01-16T16:00:00.000Z",
              end: "2024-01-16T16:30:00.000Z",
              notes: null,
              location: null,
              geo: null,
            },
            {
              uid: "foreign",
              href: "https://caldav.example/foreign.ics",
              title: "other",
              start: "2024-01-16T18:00:00.000Z",
              end: "2024-01-16T19:00:00.000Z",
              notes: null,
              location: null,
              geo: null,
            },
          ],
        },
      }),
    });
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const gw = gatewayWith(calendar, store);
    const result = await gw.execute("calendar_list", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const events = (result.data as { events: Array<{ uid: string; event_id: string | null }> })
        .events;
      expect(events[0]?.event_id).toBe(EVENT_ID);
      expect(events[1]?.event_id).toBeNull();
      expect(events[0]).not.toHaveProperty("reminder_id");
    }
    infoSpy.mockRestore();
  });

  it("updates event by event_uid", async () => {
    const event = makeEvent();
    const updated = makeEvent({
      title: "dentist 2",
      endAt: new Date("2024-01-16T17:30:00.000Z"),
    });
    const store = makeStore({
      listByUid: vi.fn().mockResolvedValue([event]),
      update: vi.fn().mockResolvedValue(updated),
    });
    const calendar = makeCalendar({
      updateEvent: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          uid: "uid-1",
          href: event.href,
          end: new Date("2024-01-16T17:30:00.000Z"),
        },
      }),
    });
    const gw = gatewayWith(calendar, store);
    const result = await gw.execute("calendar_update_event", {
      event_uid: "uid-1",
      title: "dentist 2",
      end: "2024-01-16T17:30:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(calendar.updateEvent).toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith(
      EVENT_ID,
      expect.objectContaining({
        title: "dentist 2",
        endAt: new Date("2024-01-16T17:30:00.000Z"),
      }),
    );
  });

  it("rejects ambiguous event_uid for recurring series", async () => {
    const store = makeStore({
      listByUid: vi.fn().mockResolvedValue([
        makeEvent(),
        makeEvent({
          id: "00000000-0000-4000-8000-0000000000bb",
          recurrenceId: "20240116T160000Z",
        }),
      ]),
    });
    const gw = gatewayWith(makeCalendar(), store);
    const result = await gw.execute("calendar_update_event", {
      event_uid: "uid-1",
      title: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/event_id/i);
  });

  it("rejects update of recurring events", async () => {
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(
        makeEvent({ recurrenceRule: "FREQ=WEEKLY" }),
      ),
    });
    const gw = gatewayWith(makeCalendar(), store);
    const result = await gw.execute("calendar_update_event", {
      event_id: EVENT_ID,
      title: "x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/recurring/i);
  });

  it("runs calendar_sync via tool", async () => {
    const store = makeStore({
      reconcileFromApple: vi.fn().mockResolvedValue({
        created: 2,
        updated: 1,
        unchanged: 3,
        deleted: 0,
      }),
    });
    const calendar = makeCalendar({
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
              location: null,
              geo: null,
              recurrenceId: "",
              recurrenceRule: null,
              isAllDay: false,
              cancelled: false,
              sourceUpdatedAt: null,
              alarmMinutesBefore: [],
              timeZone: "America/Chicago",
            },
            {
              uid: "b",
              href: "https://x/b.ics",
              title: "B",
              start: "2024-01-17T16:00:00.000Z",
              end: "2024-01-17T17:00:00.000Z",
              notes: null,
              location: null,
              geo: null,
              recurrenceId: "",
              recurrenceRule: null,
              isAllDay: false,
              cancelled: false,
              sourceUpdatedAt: null,
              alarmMinutesBefore: [],
              timeZone: "America/Chicago",
            },
          ],
        },
      }),
    });
    const gw = gatewayWith(calendar, store);
    const result = await gw.execute("calendar_sync", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        created: 2,
        updated: 1,
        unchanged: 3,
        deleted: 0,
      });
    }
  });

  it("deletes CalDAV then EventStore row", async () => {
    const event = makeEvent();
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(event),
      delete: vi.fn().mockResolvedValue(event),
    });
    const calendar = makeCalendar({
      deleteEvent: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { deleted: true } }),
    });
    const gw = gatewayWith(calendar, store);
    const result = await gw.execute("calendar_delete_event", {
      event_id: EVENT_ID,
    });
    expect(result.ok).toBe(true);
    expect(calendar.deleteEvent).toHaveBeenCalledWith(event.href);
    expect(store.delete).toHaveBeenCalledWith(EVENT_ID);
    if (result.ok) {
      expect(result.data).toMatchObject({
        deleted: true,
        event_id: EVENT_ID,
        event_uid: "uid-1",
      });
    }
  });

  it("alarm-only update does not require start/end", async () => {
    const event = makeEvent();
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(event),
      update: vi.fn().mockResolvedValue({
        ...event,
        alarmMinutesBefore: [30],
      }),
    });
    const calendar = makeCalendar({
      updateEvent: vi.fn().mockResolvedValue({
        ok: true,
        data: { uid: event.uid, href: event.href, end: event.endAt },
      }),
    });
    const gw = gatewayWith(calendar, store);
    const result = await gw.execute("calendar_update_event", {
      event_id: EVENT_ID,
      alarm_minutes_before: [30],
    });
    expect(result.ok).toBe(true);
    expect(calendar.updateEvent).toHaveBeenCalledWith(
      event.href,
      expect.objectContaining({ alarmMinutesBefore: [30] }),
    );
  });
});
