import { describe, expect, it, vi } from "vitest";
import type { MemoryFact } from "../memory/types.js";
import type { MemoryStore } from "../memory/store.js";
import type { MemoryRetriever } from "../memory/types.js";
import { ToolGateway } from "./gateway.js";
import { createMemoryTools } from "./memory-tools.js";

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  const now = new Date("2024-07-15T10:00:00.000Z");
  return {
    id: "00000000-0000-4000-8000-000000000001",
    branch: "user",
    topic: "смена работы",
    text: "Оффер от стартапа",
    confidence: "high",
    sensitivity: "normal",
    source: "test",
    contentHash: "h1",
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeStore(
  overrides: Partial<Record<keyof MemoryStore, unknown>> = {},
): MemoryStore {
  return {
    save: vi.fn(),
    getByIds: vi.fn(),
    getById: vi.fn(),
    deactivate: vi.fn(),
    updateEmbedding: vi.fn(),
    listForWarmProfile: vi.fn(),
    keywordFallback: vi.fn(),
    timeline: vi.fn(),
    setMeta: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore;
}

function makeRetriever(
  overrides: Partial<MemoryRetriever> = {},
): MemoryRetriever {
  return {
    search: vi.fn().mockResolvedValue([]),
    index: vi.fn(),
    ...overrides,
  };
}

function gatewayWith(
  store: MemoryStore,
  retriever: MemoryRetriever = makeRetriever(),
): ToolGateway {
  const gw = new ToolGateway();
  for (const tool of createMemoryTools({ store, retriever })) {
    gw.register(tool);
  }
  return gw;
}

describe("createMemoryTools", () => {
  it("memory_timeline returns chronological payload with dates", async () => {
    const older = makeFact({
      id: "00000000-0000-4000-8000-000000000001",
      text: "Думаю уйти",
      createdAt: new Date("2024-03-12T10:00:00.000Z"),
      updatedAt: new Date("2024-03-12T10:00:00.000Z"),
    });
    const newer = makeFact({
      id: "00000000-0000-4000-8000-000000000002",
      text: "Оффер от стартапа",
      createdAt: new Date("2024-07-15T10:00:00.000Z"),
      updatedAt: new Date("2024-07-15T10:00:00.000Z"),
    });
    const store = makeStore({
      timeline: vi.fn().mockResolvedValue([older, newer]),
    });
    const gw = gatewayWith(store);

    const result = await gw.execute("memory_timeline", {
      query: "смена работы",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      count: number;
      results: Array<{ text: string; created_at: string }>;
    };
    expect(data.count).toBe(2);
    expect(data.results[0]!.text).toBe("Думаю уйти");
    expect(data.results[0]!.created_at).toBe("2024-03-12T10:00:00.000Z");
    expect(data.results[1]!.text).toBe("Оффер от стартапа");
    expect(store.timeline).toHaveBeenCalledWith({ query: "смена работы" });
  });

  it("memory_timeline rejects empty query", async () => {
    const store = makeStore();
    const gw = gatewayWith(store);
    const result = await gw.execute("memory_timeline", { query: "" });
    expect(result.ok).toBe(false);
    expect(store.timeline).not.toHaveBeenCalled();
  });

  it("memory_search still uses retriever", async () => {
    const fact = makeFact();
    const store = makeStore({
      getByIds: vi.fn().mockResolvedValue([fact]),
    });
    const retriever = makeRetriever({
      search: vi.fn().mockResolvedValue([{ id: fact.id, score: 0.9 }]),
    });
    const gw = gatewayWith(store, retriever);
    const result = await gw.execute("memory_search", { query: "работа" });
    expect(result.ok).toBe(true);
    expect(retriever.search).toHaveBeenCalled();
    expect(store.timeline).not.toHaveBeenCalled();
  });

  it("memory_search description routes trips to theme tools", () => {
    const gw = gatewayWith(makeStore());
    const tool = gw.listRealtimeTools().find((t) => t.name === "memory_search");
    expect(tool?.description).toMatch(/NOT for trips/i);
    expect(tool?.description).toMatch(/theme_list|theme_search|theme_get/);
  });
});
