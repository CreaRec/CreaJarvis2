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
    expect(calendar.createEvent).toHaveBeenCalled();
    expect(store.setCalendarLink).toHaveBeenCalledWith(
      REM_ID,
      expect.objectContaining({
        uid: "uid-1",
        href: "https://caldav.example/uid-1.ics",
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
            },
            {
              uid: "uid-b",
              href: "https://x/b.ics",
              title: "B",
              start: "2024-01-16T18:00:00.000Z",
              end: "2024-01-16T18:30:00.000Z",
              notes: null,
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
        events: Array<{ uid: string; reminder_id: string | null }>;
      };
      expect(data.events[0]?.reminder_id).toBe(REM_ID);
      expect(data.events[1]?.reminder_id).toBeNull();
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
    expect(calendar.updateEvent).toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith(
      REM_ID,
      expect.objectContaining({
        text: "new title",
        fireAt: new Date("2024-01-16T17:00:00.000Z"),
      }),
    );
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
