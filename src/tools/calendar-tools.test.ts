import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import type { ICloudCalendarClient } from "../calendar/icloud-client.js";
import type { ReminderRecord } from "../reminders/types.js";
import type { ReminderStore } from "../reminders/store.js";
import { ToolGateway } from "./gateway.js";
import { createCalendarTools } from "./calendar-tools.js";
import { createReminderTools } from "./reminder-tools.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    OPENAI_API_KEY: "test",
    DATABASE_URL: "postgres://x",
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

const REM_ID = "00000000-0000-4000-8000-000000000001";

function makeRecord(
  overrides: Partial<ReminderRecord> = {},
): ReminderRecord {
  const now = new Date("2024-01-15T18:00:00.000Z");
  return {
    id: REM_ID,
    text: "dentist",
    fireAt: new Date("2024-01-16T16:00:00.000Z"),
    timezone: "America/Chicago",
    status: "pending",
    rawUtterance: null,
    recurrence: null,
    quietHoursOverride: null,
    deliveredAt: null,
    calendarUid: null,
    calendarHref: null,
    calendarEndAt: null,
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
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    ...overrides,
  };
}

function makeStore(
  overrides: Partial<ReminderStore> = {},
): ReminderStore {
  return {
    create: vi.fn(),
    getById: vi.fn(),
    getByCalendarUid: vi.fn(),
    getByCalendarUids: vi.fn(),
    setCalendarLink: vi.fn(),
    clearCalendarLink: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    cancelMany: vi.fn(),
    listForCancelMany: vi.fn(),
    ...overrides,
  } as unknown as ReminderStore;
}

describe("createCalendarTools", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("creates event and stores calendar link", async () => {
    const reminder = makeRecord();
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://caldav.example/uid-1.ics",
      calendarEndAt: new Date("2024-01-16T16:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(reminder),
      setCalendarLink: vi.fn().mockResolvedValue(linked),
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
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_create_event", {
      reminder_id: REM_ID,
      title: "dentist",
      start: "2024-01-16T16:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        start_iso: string;
        end_iso: string;
        start_local: string;
        end_local: string;
      };
      expect(data.start_iso).toBe("2024-01-16T16:00:00.000Z");
      expect(data.end_iso).toBe("2024-01-16T16:30:00.000Z");
      expect(data.start_local).toBeTruthy();
      expect(data.end_local).toBeTruthy();
    }
    expect(calendar.createEvent).toHaveBeenCalled();
    expect(store.setCalendarLink).toHaveBeenCalledWith(
      REM_ID,
      expect.objectContaining({
        uid: "uid-1",
        href: "https://caldav.example/uid-1.ics",
      }),
    );
  });

  it("passes reminder location into createEvent and persists overrides", async () => {
    const reminder = makeRecord({
      locationName: "Starbucks",
      locationAddress: "123 Lamar Blvd, Austin, TX",
      locationMapsUrl: "https://maps.google.com/?cid=1",
      locationLat: 30.27,
      locationLon: -97.74,
    });
    const linked = makeRecord({
      ...reminder,
      calendarUid: "uid-loc",
      calendarHref: "https://caldav.example/uid-loc.ics",
      calendarEndAt: new Date("2024-01-16T16:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi
        .fn()
        .mockResolvedValueOnce(reminder)
        .mockResolvedValue(linked),
      update: vi.fn().mockResolvedValue(linked),
      setCalendarLink: vi.fn().mockResolvedValue(linked),
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
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_create_event", {
      reminder_id: REM_ID,
      title: "Coffee",
      start: "2024-01-16T16:00:00.000Z",
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

  it("rejects create when already linked", async () => {
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(
        makeRecord({ calendarUid: "existing" }),
      ),
    });
    const calendar = makeCalendar();
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_create_event", {
      reminder_id: REM_ID,
      title: "x",
      start: "2024-01-16T16:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already linked/i);
    expect(calendar.createEvent).not.toHaveBeenCalled();
  });

  it("enriches list with reminder_id", async () => {
    const store = makeStore({
      getByCalendarUids: vi.fn().mockResolvedValue([
        makeRecord({
          calendarUid: "uid-a",
          calendarHref: "https://x/a.ics",
        }),
      ]),
    });
    const calendar = makeCalendar({
      listEvents: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          events: [
            {
              uid: "uid-a",
              href: "https://x/a.ics",
              title: "A",
              start: "2024-01-16T16:00:00.000Z",
              end: "2024-01-16T16:30:00.000Z",
              notes: null,
              location: null,
              geo: null,
            },
            {
              uid: "uid-b",
              href: "https://x/b.ics",
              title: "B",
              start: "2024-01-16T18:00:00.000Z",
              end: "2024-01-16T18:30:00.000Z",
              notes: null,
              location: null,
              geo: null,
            },
          ],
        },
      }),
    });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_list", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        events: Array<{
          uid: string;
          reminder_id: string | null;
          start_iso: string | null;
          end_iso: string | null;
          start_local: string | null;
          end_local: string | null;
        }>;
      };
      expect(data.events[0]?.reminder_id).toBe(REM_ID);
      expect(data.events[1]?.reminder_id).toBeNull();
      expect(data.events[0]?.start_iso).toBe("2024-01-16T16:00:00.000Z");
      expect(data.events[0]?.end_iso).toBe("2024-01-16T16:30:00.000Z");
      expect(data.events[0]?.start_local).toBeTruthy();
      expect(data.events[0]?.end_local).toBeTruthy();
      expect(data.events[0]?.start_local).not.toMatch(/Z$/);
    }
  });

  it("deletes by reminder_id and clears link", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
      calendarEndAt: new Date("2024-01-16T16:30:00.000Z"),
    });
    const cleared = makeRecord();
    const store = makeStore({
      getById: vi
        .fn()
        .mockResolvedValueOnce(linked)
        .mockResolvedValueOnce(cleared),
      clearCalendarLink: vi.fn().mockResolvedValue(cleared),
    });
    const calendar = makeCalendar({
      deleteEvent: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
    });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_delete_event", {
      reminder_id: REM_ID,
    });
    expect(result.ok).toBe(true);
    expect(calendar.deleteEvent).toHaveBeenCalledWith("https://x/uid-1.ics");
    expect(store.clearCalendarLink).toHaveBeenCalledWith(REM_ID);
    expect(store.cancel).not.toHaveBeenCalled();
  });

  it("updates event by event_uid", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
      calendarEndAt: new Date("2024-01-16T16:30:00.000Z"),
    });
    const store = makeStore({
      getByCalendarUid: vi.fn().mockResolvedValue(linked),
      update: vi.fn().mockResolvedValue(
        makeRecord({
          ...linked,
          text: "new title",
          fireAt: new Date("2024-01-16T17:00:00.000Z"),
          calendarEndAt: new Date("2024-01-16T17:30:00.000Z"),
        }),
      ),
    });
    const calendar = makeCalendar({
      updateEvent: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          uid: "uid-1",
          href: "https://x/uid-1.ics",
          end: new Date("2024-01-16T17:30:00.000Z"),
        },
      }),
    });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_update_event", {
      event_uid: "uid-1",
      title: "new title",
      start: "2024-01-16T17:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(calendar.updateEvent).toHaveBeenCalledWith(
      "https://x/uid-1.ics",
      expect.objectContaining({
        uid: "uid-1",
        title: "new title",
        start: new Date("2024-01-16T17:00:00.000Z"),
        end: new Date("2024-01-16T17:30:00.000Z"),
      }),
    );
    expect(store.update).toHaveBeenCalledWith(
      REM_ID,
      expect.objectContaining({
        text: "new title",
        fireAt: new Date("2024-01-16T17:00:00.000Z"),
      }),
    );
  });

  it("alarm-only update passes only alarmMinutesBefore and skips store duration patch", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
      calendarEndAt: new Date("2024-01-16T18:00:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(linked),
      update: vi.fn(),
    });
    const updateEvent = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        uid: "uid-1",
        href: "https://x/uid-1.ics",
        end: new Date("2024-01-16T18:00:00.000Z"),
      },
    });
    const calendar = makeCalendar({ updateEvent });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_update_event", {
      reminder_id: REM_ID,
      alarm_minutes_before: [30],
    });
    expect(result.ok).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith("https://x/uid-1.ics", {
      uid: "uid-1",
      timeZone: "America/Chicago",
      alarmMinutesBefore: [30],
    });
    expect(store.update).not.toHaveBeenCalled();
  });

  it("location-only update pins start/end from reminder fireAt", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
      fireAt: new Date("2026-08-24T14:00:00.000Z"),
      calendarEndAt: new Date("2026-08-24T14:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(linked),
      update: vi.fn().mockResolvedValue(linked),
    });
    const updateEvent = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        uid: "uid-1",
        href: "https://x/uid-1.ics",
        end: new Date("2026-08-24T14:30:00.000Z"),
      },
    });
    const calendar = makeCalendar({ updateEvent });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_update_event", {
      reminder_id: REM_ID,
      location_name: "Clinic",
      location_address: "1 Main St",
    });
    expect(result.ok).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith(
      "https://x/uid-1.ics",
      expect.objectContaining({
        start: new Date("2026-08-24T14:00:00.000Z"),
        end: new Date("2026-08-24T14:30:00.000Z"),
        location: "1 Main St",
        mapsUrl: null,
      }),
    );
  });

  it("location update with maps URL passes mapsUrl for DESCRIPTION merge", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
      fireAt: new Date("2026-08-24T14:00:00.000Z"),
      calendarEndAt: new Date("2026-08-24T14:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(linked),
      update: vi.fn().mockResolvedValue(linked),
    });
    const updateEvent = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        uid: "uid-1",
        href: "https://x/uid-1.ics",
        end: new Date("2026-08-24T14:30:00.000Z"),
      },
    });
    const calendar = makeCalendar({ updateEvent });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const maps = "https://maps.google.com/?cid=537976887965764502";
    const result = await gw.execute("calendar_update_event", {
      reminder_id: REM_ID,
      location_name: "Clinic",
      location_address: "1 Main St",
      location_maps_url: maps,
    });
    expect(result.ok).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith(
      "https://x/uid-1.ics",
      expect.objectContaining({
        location: "1 Main St",
        mapsUrl: maps,
      }),
    );
    expect(updateEvent.mock.calls[0]![1]).not.toHaveProperty("description");
  });

  it("end-only duration update pins start from reminder fireAt", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
      fireAt: new Date("2026-08-24T14:00:00.000Z"),
      calendarEndAt: new Date("2026-08-24T14:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(linked),
      update: vi.fn().mockResolvedValue(linked),
    });
    const updateEvent = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        uid: "uid-1",
        href: "https://x/uid-1.ics",
        end: new Date("2026-08-24T14:45:00.000Z"),
      },
    });
    const calendar = makeCalendar({ updateEvent });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_update_event", {
      reminder_id: REM_ID,
      end: "2026-08-24T14:45:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith(
      "https://x/uid-1.ics",
      expect.objectContaining({
        start: new Date("2026-08-24T14:00:00.000Z"),
        end: new Date("2026-08-24T14:45:00.000Z"),
      }),
    );
  });

  it("create passes custom and empty alarm_minutes_before", async () => {
    const reminder = makeRecord();
    const linked = makeRecord({
      calendarUid: "uid-alarms",
      calendarHref: "https://caldav.example/uid-alarms.ics",
      calendarEndAt: new Date("2024-01-16T16:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(reminder),
      setCalendarLink: vi.fn().mockResolvedValue(linked),
    });
    const createEvent = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        uid: "uid-alarms",
        href: "https://caldav.example/uid-alarms.ics",
        end: new Date("2024-01-16T16:30:00.000Z"),
      },
    });
    const calendar = makeCalendar({ createEvent });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }

    await gw.execute("calendar_create_event", {
      reminder_id: REM_ID,
      title: "dentist",
      start: "2024-01-16T16:00:00.000Z",
      alarm_minutes_before: [30],
    });
    expect(createEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ alarmMinutesBefore: [30] }),
    );

    const reminder2 = makeRecord();
    store.getById = vi.fn().mockResolvedValue(reminder2);
    await gw.execute("calendar_create_event", {
      reminder_id: REM_ID,
      title: "dentist",
      start: "2024-01-16T16:00:00.000Z",
      alarm_minutes_before: [],
    });
    expect(createEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ alarmMinutesBefore: [] }),
    );
  });

  it("create omits alarmMinutesBefore when param omitted", async () => {
    const reminder = makeRecord();
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://caldav.example/uid-1.ics",
      calendarEndAt: new Date("2024-01-16T16:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(reminder),
      setCalendarLink: vi.fn().mockResolvedValue(linked),
    });
    const createEvent = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        uid: "uid-1",
        href: "https://caldav.example/uid-1.ics",
        end: new Date("2024-01-16T16:30:00.000Z"),
      },
    });
    const calendar = makeCalendar({ createEvent });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    await gw.execute("calendar_create_event", {
      reminder_id: REM_ID,
      title: "dentist",
      start: "2024-01-16T16:00:00.000Z",
    });
    expect(createEvent).toHaveBeenCalledWith(
      expect.not.objectContaining({
        alarmMinutesBefore: expect.anything(),
      }),
    );
  });

  it("update restores defaults when alarm_minutes_before is null", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
      calendarEndAt: new Date("2024-01-16T16:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(linked),
      update: vi.fn().mockResolvedValue(linked),
    });
    const updateEvent = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        uid: "uid-1",
        href: "https://x/uid-1.ics",
        end: new Date("2024-01-16T16:30:00.000Z"),
      },
    });
    const calendar = makeCalendar({ updateEvent });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_update_event", {
      reminder_id: REM_ID,
      alarm_minutes_before: null,
    });
    expect(result.ok).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith("https://x/uid-1.ics", {
      uid: "uid-1",
      timeZone: "America/Chicago",
      alarmMinutesBefore: [60, 15],
    });
    expect(store.update).not.toHaveBeenCalled();
  });

  it("update clears alarms when alarm_minutes_before is empty", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
      calendarEndAt: new Date("2024-01-16T16:30:00.000Z"),
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(linked),
      update: vi.fn().mockResolvedValue(linked),
    });
    const updateEvent = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        uid: "uid-1",
        href: "https://x/uid-1.ics",
        end: new Date("2024-01-16T16:30:00.000Z"),
      },
    });
    const calendar = makeCalendar({ updateEvent });
    const gw = new ToolGateway();
    for (const tool of createCalendarTools({
      calendar,
      store,
      config: makeConfig(),
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("calendar_update_event", {
      reminder_id: REM_ID,
      alarm_minutes_before: [],
    });
    expect(result.ok).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith("https://x/uid-1.ics", {
      uid: "uid-1",
      timeZone: "America/Chicago",
      alarmMinutesBefore: [],
    });
    expect(store.update).not.toHaveBeenCalled();
  });
});

describe("reminder_create offer_calendar", () => {
  it("sets offer_calendar true when calendar enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z"));
    const store = makeStore({
      create: vi.fn().mockResolvedValue(makeRecord()),
    });
    const calendar = makeCalendar();
    const gw = new ToolGateway();
    for (const tool of createReminderTools({
      store,
      config: makeConfig(),
      calendarEnabled: true,
      calendar,
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("reminder_create", {
      text: "x",
      fire_at: "2024-01-16T16:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.data as { offer_calendar: boolean }).offer_calendar,
      ).toBe(true);
    }
  });

  it("sets offer_calendar false when calendar disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z"));
    const store = makeStore({
      create: vi.fn().mockResolvedValue(makeRecord()),
    });
    const gw = new ToolGateway();
    for (const tool of createReminderTools({
      store,
      config: makeConfig(),
      calendarEnabled: false,
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("reminder_create", {
      text: "x",
      fire_at: "2024-01-16T16:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.data as { offer_calendar: boolean }).offer_calendar,
      ).toBe(false);
    }
  });

  it("best-effort deletes calendar on reminder_cancel", async () => {
    const linked = makeRecord({
      calendarUid: "uid-1",
      calendarHref: "https://x/uid-1.ics",
    });
    const store = makeStore({
      getById: vi.fn().mockResolvedValue(linked),
      cancel: vi.fn().mockResolvedValue(
        makeRecord({ ...linked, status: "cancelled" }),
      ),
      clearCalendarLink: vi.fn().mockResolvedValue(makeRecord()),
    });
    const calendar = makeCalendar({
      deleteEvent: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
    });
    const gw = new ToolGateway();
    for (const tool of createReminderTools({
      store,
      config: makeConfig(),
      calendarEnabled: true,
      calendar,
    })) {
      gw.register(tool);
    }
    const result = await gw.execute("reminder_cancel", { id: REM_ID });
    expect(result.ok).toBe(true);
    expect(calendar.deleteEvent).toHaveBeenCalledWith("https://x/uid-1.ics");
    expect(store.cancel).toHaveBeenCalledWith(REM_ID);
  });
});
