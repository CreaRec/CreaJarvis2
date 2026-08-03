import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import type { DayPlanRecord, PlanItemRecord } from "../plans/types.js";
import type { PlanStore } from "../plans/store.js";
import { ToolGateway } from "./gateway.js";
import { createPlanTools } from "./plan-tools.js";

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

function emptyDay(date = "2024-01-15"): DayPlanRecord {
  return {
    id: "plan-1",
    localDate: date,
    timezone: "America/Chicago",
    items: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeItem(
  overrides: Partial<PlanItemRecord> = {},
): PlanItemRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    planId: "plan-1",
    localDate: "2024-01-15",
    text: "спорт",
    status: "open",
    sortOrder: 0,
    scheduledAt: null,
    reminderId: null,
    recurrence: null,
    rawUtterance: null,
    timezone: "America/Chicago",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStore(
  overrides: Partial<Record<keyof PlanStore, unknown>> = {},
): PlanStore {
  return {
    setDay: vi.fn(),
    addItems: vi.fn(),
    getOrEmpty: vi.fn(),
    listRange: vi.fn(),
    search: vi.fn(),
    updateItem: vi.fn(),
    completeItem: vi.fn(),
    cancelItem: vi.fn(),
    moveItem: vi.fn(),
    carryOver: vi.fn(),
    clearDay: vi.fn(),
    ...overrides,
  } as unknown as PlanStore;
}

function gatewayWith(store: PlanStore, config = makeConfig()): ToolGateway {
  const gw = new ToolGateway();
  for (const tool of createPlanTools({ store, config })) {
    gw.register(tool);
  }
  return gw;
}

describe("createPlanTools", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("plan_add rejects invalid date", async () => {
    const store = makeStore();
    const gw = gatewayWith(store);
    const result = await gw.execute("plan_add", {
      date: "not-a-date",
      items: [{ text: "x" }],
    });
    expect(result.ok).toBe(false);
    expect(store.addItems).not.toHaveBeenCalled();
  });

  it("plan_add rejects past scheduled_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z"));
    const store = makeStore();
    const gw = gatewayWith(store);
    const result = await gw.execute("plan_add", {
      date: "2024-01-15",
      items: [
        {
          text: "late",
          scheduled_at: "2024-01-15T17:00:00.000Z",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/past/i);
    expect(store.addItems).not.toHaveBeenCalled();
  });

  it("plan_add happy path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
    const day = emptyDay();
    day.items = [makeItem()];
    const store = makeStore({
      addItems: vi.fn().mockResolvedValue(day),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("plan_add", {
      date: "2024-01-15",
      items: [{ text: "спорт" }],
    });
    expect(result.ok).toBe(true);
    expect(store.addItems).toHaveBeenCalled();
  });

  it("plan_get defaults to today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z"));
    const store = makeStore({
      getOrEmpty: vi.fn().mockResolvedValue(emptyDay("2024-01-15")),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("plan_get", {});
    expect(result.ok).toBe(true);
    expect(store.getOrEmpty).toHaveBeenCalledWith("2024-01-15");
  });

  it("plan_complete_item", async () => {
    const store = makeStore({
      completeItem: vi
        .fn()
        .mockResolvedValue(makeItem({ status: "done" })),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("plan_complete_item", {
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(true);
  });

  it("plan_cancel_item", async () => {
    const store = makeStore({
      cancelItem: vi
        .fn()
        .mockResolvedValue(makeItem({ status: "cancelled" })),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("plan_cancel_item", {
      id: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(true);
  });

  it("plan_carry_over defaults today→tomorrow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z"));
    const store = makeStore({
      carryOver: vi.fn().mockResolvedValue(emptyDay("2024-01-16")),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("plan_carry_over", {});
    expect(result.ok).toBe(true);
    expect(store.carryOver).toHaveBeenCalledWith("2024-01-15", "2024-01-16");
  });

  it("plan_clear", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T18:00:00.000Z"));
    const store = makeStore({
      clearDay: vi.fn().mockResolvedValue(emptyDay()),
    });
    const gw = gatewayWith(store);
    const result = await gw.execute("plan_clear", {});
    expect(result.ok).toBe(true);
    expect(store.clearDay).toHaveBeenCalledWith("2024-01-15", true);
  });
});
