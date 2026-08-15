import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { ReminderPoller } from "./poller.js";
import type { ReminderStore } from "./store.js";
import type { DeviceRegistry } from "./device-registry.js";
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

describe("ReminderPoller", () => {
  it("start logs skipped and does not claim due reminders", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const store = {} as unknown as ReminderStore;
    const registry = {} as unknown as DeviceRegistry;
    const poller = new ReminderPoller(store, registry, makeConfig());
    poller.start();
    expect(infoSpy).toHaveBeenCalledWith(
      "[reminders] poller disabled (Apple-only alerts)",
      expect.objectContaining({
        handler: "reminder_poll",
        result: "skipped",
      }),
    );
    poller.stop();
    infoSpy.mockRestore();
  });
});
