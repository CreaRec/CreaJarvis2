import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import type { ReminderRecord } from "../reminders/types.js";
import type { ReminderStore } from "../reminders/store.js";
import { ToolGateway } from "./gateway.js";
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
    ...overrides,
  };
}

function makeRecord(
  overrides: Partial<ReminderRecord> = {},
): ReminderRecord {
  const now = new Date("2024-01-15T18:00:00.000Z");
  return {
    id: "00000000-0000-4000-8000-000000000001",
    text: "купить молоко",
    fireAt: new Date("2024-01-16T16:00:00.000Z"),
    timezone: "America/Chicago",
    status: "pending",
    rawUtterance: "напомни купить молоко",
    recurrence: null,
    quietHoursOverride: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeStore(
  overrides: Partial<{
    create: ReminderStore["create"];
    list: ReminderStore["list"];
    search: ReminderStore["search"];
    update: ReminderStore["update"];
    cancel: ReminderStore["cancel"];
    cancelMany: ReminderStore["cancelMany"];
  }> = {},
): ReminderStore {
  return {
    create: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    cancelMany: vi.fn(),
    ...overrides,
  } as unknown as ReminderStore;
}

function gatewayWith(store: ReminderStore, config = makeConfig()): ToolGateway {
  const gw = new ToolGateway();
  for (const tool of createReminderTools({ store, config })) {
    gw.register(tool);
  }
  return gw;
}

describe("createReminderTools", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe("reminder_create", () => {
    it("rejects fire_at more than 30s in the past", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z"));
      const store = makeStore();
      const gw = gatewayWith(store);
      const result = await gw.execute("reminder_create", {
        text: "late",
        fire_at: "2024-01-15T17:59:00.000Z",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/past/i);
      expect(store.create).not.toHaveBeenCalled();
    });

    it("rejects invalid fire_at", async () => {
      const store = makeStore();
      const gw = gatewayWith(store);
      const result = await gw.execute("reminder_create", {
        text: "x",
        fire_at: "not-a-date",
      });
      expect(result).toEqual({
        ok: false,
        error: "Invalid fire_at ISO timestamp",
      });
    });

    it("creates a reminder for a future fire_at", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z"));
      const record = makeRecord();
      const store = makeStore({ create: vi.fn().mockResolvedValue(record) });
      const gw = gatewayWith(store);
      const result = await gw.execute("reminder_create", {
        text: "купить молоко",
        fire_at: "2024-01-16T16:00:00.000Z",
        raw_utterance: "напомни купить молоко",
      });
      expect(result.ok).toBe(true);
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "купить молоко",
          timezone: "America/Chicago",
          rawUtterance: "напомни купить молоко",
        }),
      );
    });
  });

  describe("reminder_cancel", () => {
    it("cancels by id", async () => {
      const record = makeRecord({ status: "cancelled" });
      const store = makeStore({ cancel: vi.fn().mockResolvedValue(record) });
      const gw = gatewayWith(store);
      const result = await gw.execute("reminder_cancel", { id: record.id });
      expect(result.ok).toBe(true);
      expect(store.cancel).toHaveBeenCalledWith(record.id);
    });

    it("asks for clarification when query matches multiple", async () => {
      const a = makeRecord({ id: "00000000-0000-4000-8000-000000000001" });
      const b = makeRecord({
        id: "00000000-0000-4000-8000-000000000002",
        text: "купить хлеб",
      });
      const store = makeStore({
        search: vi.fn().mockResolvedValue([a, b]),
      });
      const gw = gatewayWith(store);
      const result = await gw.execute("reminder_cancel", { query: "купить" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toMatchObject({ need_clarification: true });
        expect(
          (result.data as { candidates: unknown[] }).candidates,
        ).toHaveLength(2);
      }
      expect(store.cancel).not.toHaveBeenCalled();
    });

    it("cancels the single query match", async () => {
      const record = makeRecord();
      const store = makeStore({
        search: vi.fn().mockResolvedValue([record]),
        cancel: vi
          .fn()
          .mockResolvedValue({ ...record, status: "cancelled" as const }),
      });
      const gw = gatewayWith(store);
      const result = await gw.execute("reminder_cancel", {
        query: "молоко",
      });
      expect(result.ok).toBe(true);
      expect(store.cancel).toHaveBeenCalledWith(record.id);
    });
  });

  describe("reminder_snooze", () => {
    it("sets quietHoursOverride for short minute snooze", async () => {
      const record = makeRecord({
        status: "snoozed",
        quietHoursOverride: true,
      });
      const store = makeStore({
        update: vi.fn().mockResolvedValue(record),
      });
      const gw = gatewayWith(store);
      const result = await gw.execute("reminder_snooze", {
        id: record.id,
        minutes: 30,
      });
      expect(result.ok).toBe(true);
      expect(store.update).toHaveBeenCalledWith(
        record.id,
        expect.objectContaining({
          status: "snoozed",
          quietHoursOverride: true,
        }),
      );
    });

    it("does not set quietHoursOverride for long snooze unless requested", async () => {
      const record = makeRecord({ status: "snoozed" });
      const store = makeStore({
        update: vi.fn().mockResolvedValue(record),
      });
      const gw = gatewayWith(store);
      await gw.execute("reminder_snooze", {
        id: record.id,
        minutes: 120,
      });
      expect(store.update).toHaveBeenCalledWith(
        record.id,
        expect.objectContaining({
          quietHoursOverride: null,
        }),
      );
    });
  });

  describe("reminder_cancel_many", () => {
    it("cancels all_pending", async () => {
      const store = makeStore({
        cancelMany: vi.fn().mockResolvedValue(3),
      });
      const gw = gatewayWith(store);
      const result = await gw.execute("reminder_cancel_many", {
        scope: "all_pending",
      });
      expect(result).toEqual({ ok: true, data: { cancelled: 3 } });
      expect(store.cancelMany).toHaveBeenCalledWith({ scope: "all_pending" });
    });

    it("cancels today with local day bounds", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z")); // noon CST
      const store = makeStore({
        cancelMany: vi.fn().mockResolvedValue(1),
      });
      const gw = gatewayWith(store);
      await gw.execute("reminder_cancel_many", { scope: "today" });
      expect(store.cancelMany).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "today",
          todayStart: expect.any(Date),
          todayEnd: expect.any(Date),
        }),
      );
      const arg = vi.mocked(store.cancelMany).mock.calls[0]![0] as {
        todayStart: Date;
        todayEnd: Date;
      };
      expect(arg.todayEnd.getTime() - arg.todayStart.getTime()).toBeGreaterThan(
        20 * 60 * 60 * 1000,
      );
    });
  });
});
