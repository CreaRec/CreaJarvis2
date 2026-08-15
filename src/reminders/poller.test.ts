import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { AppConfig } from "../config.js";
import { zonedLocalToUtc } from "../utils/time/index.js";
import { DeviceRegistry } from "./device-registry.js";
import { ReminderPoller } from "./poller.js";
import type { ReminderStore } from "./store.js";
import type { ReminderRecord } from "./types.js";

const TZ = "America/Chicago";

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
    USER_TIMEZONE: TZ,
    REMINDER_MORNING_HOUR: 10,
    REMINDER_AFTERNOON_HOUR: 14,
    REMINDER_EVENING_HOUR: 18,
    REMINDER_NIGHT_HOUR: 21,
    REMINDER_QUIET_START: 22,
    REMINDER_QUIET_END: 8,
    REMINDER_POLL_MS: 60_000,
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

function makeRecord(
  overrides: Partial<ReminderRecord> = {},
): ReminderRecord {
  const now = new Date("2024-01-15T18:00:00.000Z");
  return {
    id: "00000000-0000-4000-8000-000000000001",
    text: "test",
    fireAt: now,
    timezone: TZ,
    status: "delivering",
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

function makeStore(
  claimDue: ReminderRecord[],
): {
  store: ReminderStore;
  update: ReturnType<typeof vi.fn>;
  markMissed: ReturnType<typeof vi.fn>;
  completeDelivery: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn().mockResolvedValue(null);
  const markMissed = vi.fn().mockResolvedValue(null);
  const completeDelivery = vi.fn().mockResolvedValue(null);
  const store = {
    claimDue: vi.fn().mockResolvedValue(claimDue),
    update,
    markMissed,
    completeDelivery,
  } as unknown as ReminderStore;
  return { store, update, markMissed, completeDelivery };
}

function registerOpen(
  registry: DeviceRegistry,
  deviceId = "d1",
): { socket: WebSocket; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn();
  const socket = { readyState: 1, send, close: vi.fn() } as unknown as WebSocket;
  registry.register(deviceId, socket, deviceId, {
    voice: true,
    notify: true,
  });
  return { socket, send };
}

async function runTick(poller: ReminderPoller): Promise<void> {
  await (
    poller as unknown as { tick: () => Promise<void> }
  ).tick();
}

describe("ReminderPoller", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("defers delivery during quiet hours unless override is set", async () => {
    vi.useFakeTimers();
    // 23:00 Chicago local
    vi.setSystemTime(zonedLocalToUtc(TZ, 2024, 1, 15, 23, 0, 0));
    const reminder = makeRecord();
    const { store, update, markMissed, completeDelivery } = makeStore([
      reminder,
    ]);
    const registry = new DeviceRegistry();
    registerOpen(registry);
    const poller = new ReminderPoller(store, registry, makeConfig());

    await runTick(poller);

    expect(update).toHaveBeenCalledWith(
      reminder.id,
      expect.objectContaining({ status: "pending" }),
    );
    expect(markMissed).not.toHaveBeenCalled();
    expect(completeDelivery).not.toHaveBeenCalled();
  });

  it("delivers during quiet hours when quietHoursOverride is true", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(zonedLocalToUtc(TZ, 2024, 1, 15, 23, 0, 0));
    const reminder = makeRecord({ quietHoursOverride: true });
    const { store, update, markMissed, completeDelivery } = makeStore([
      reminder,
    ]);
    const registry = new DeviceRegistry();
    const { send } = registerOpen(registry);
    const poller = new ReminderPoller(store, registry, makeConfig());

    await runTick(poller);

    expect(update).not.toHaveBeenCalled();
    expect(completeDelivery).toHaveBeenCalledWith(reminder.id);
    expect(markMissed).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalled();
  });

  it("marks missed when no clients are connected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(zonedLocalToUtc(TZ, 2024, 1, 15, 12, 0, 0));
    const reminder = makeRecord();
    const { store, markMissed, completeDelivery } = makeStore([reminder]);
    const registry = new DeviceRegistry();
    const poller = new ReminderPoller(store, registry, makeConfig());

    await runTick(poller);

    expect(markMissed).toHaveBeenCalledWith(reminder.id);
    expect(completeDelivery).not.toHaveBeenCalled();
  });

  it("completes delivery after successful broadcast", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(zonedLocalToUtc(TZ, 2024, 1, 15, 12, 0, 0));
    const reminder = makeRecord();
    const { store, markMissed, completeDelivery } = makeStore([reminder]);
    const registry = new DeviceRegistry();
    registerOpen(registry);
    const poller = new ReminderPoller(store, registry, makeConfig());

    await runTick(poller);

    expect(completeDelivery).toHaveBeenCalledWith(reminder.id);
    expect(markMissed).not.toHaveBeenCalled();
  });

  it("marks missed when all sockets are non-open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(zonedLocalToUtc(TZ, 2024, 1, 15, 12, 0, 0));
    const reminder = makeRecord();
    const { store, markMissed, completeDelivery } = makeStore([reminder]);
    const registry = new DeviceRegistry();
    const socket = {
      readyState: 3,
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;
    registry.register("d1", socket, "d1", { voice: true, notify: true });
    const poller = new ReminderPoller(store, registry, makeConfig());

    await runTick(poller);

    expect(markMissed).toHaveBeenCalledWith(reminder.id);
    expect(completeDelivery).not.toHaveBeenCalled();
  });
});
