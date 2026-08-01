import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MemoryStore, scoreFactMatch } from "./store.js";

function makeRow(
  overrides: Partial<{
    id: string;
    branch: "user" | "directives" | "world";
    topic: string;
    text: string;
    confidence: "high" | "medium" | "assumption";
    sensitivity: "normal" | "private";
    source: string;
    contentHash: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  const now = new Date("2024-06-01T12:00:00.000Z");
  return {
    id: "00000000-0000-4000-8000-000000000001",
    branch: "user" as const,
    topic: "",
    text: "fact",
    confidence: "medium" as const,
    sensitivity: "normal" as const,
    source: "",
    contentHash: "hash",
    active: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("scoreFactMatch", () => {
  it("scores phrase higher than single tokens", () => {
    const tokens = ["смена", "работы"];
    const phrase = scoreFactMatch(
      "смена работы",
      tokens,
      "работа",
      "смена работы к концу года",
    );
    const partial = scoreFactMatch(
      "смена работы",
      tokens,
      "",
      "любит работу в саду",
    );
    expect(phrase).toBeGreaterThan(partial);
  });
});

describe("MemoryStore.timeline", () => {
  let db: { fact: { findMany: ReturnType<typeof vi.fn> } };
  let store: MemoryStore;

  beforeEach(() => {
    db = { fact: { findMany: vi.fn() } };
    store = new MemoryStore(db as unknown as PrismaClient);
  });

  it("returns facts oldest to newest", async () => {
    db.fact.findMany.mockResolvedValue([
      makeRow({
        id: "00000000-0000-4000-8000-000000000001",
        text: "Думаю уйти к концу года",
        topic: "смена работы",
        createdAt: new Date("2024-03-12T10:00:00.000Z"),
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000002",
        text: "Остаюсь до сентября — бонус",
        topic: "смена работы",
        createdAt: new Date("2024-04-03T10:00:00.000Z"),
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000003",
        text: "Оффер от стартапа",
        topic: "смена работы",
        createdAt: new Date("2024-07-15T10:00:00.000Z"),
      }),
    ]);

    const facts = await store.timeline({ query: "смена работы" });
    expect(facts.map((f) => f.text)).toEqual([
      "Думаю уйти к концу года",
      "Остаюсь до сентября — бонус",
      "Оффер от стартапа",
    ]);
    expect(db.fact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("keeps the most recent window when over limit", async () => {
    db.fact.findMany.mockResolvedValue([
      makeRow({
        id: "00000000-0000-4000-8000-000000000001",
        text: "старая смена работы",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000002",
        text: "средняя смена работы",
        createdAt: new Date("2024-02-01T00:00:00.000Z"),
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000003",
        text: "новая смена работы",
        createdAt: new Date("2024-03-01T00:00:00.000Z"),
      }),
    ]);

    const facts = await store.timeline({ query: "смена работы", limit: 2 });
    expect(facts.map((f) => f.text)).toEqual([
      "средняя смена работы",
      "новая смена работы",
    ]);
  });

  it("returns empty when query has no usable tokens", async () => {
    const facts = await store.timeline({ query: "  " });
    expect(facts).toEqual([]);
    expect(db.fact.findMany).not.toHaveBeenCalled();
  });

  it("filters zero-score noise", async () => {
    db.fact.findMany.mockResolvedValue([
      makeRow({
        id: "00000000-0000-4000-8000-000000000001",
        text: "полностью про другое",
        topic: "еда",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
      makeRow({
        id: "00000000-0000-4000-8000-000000000002",
        text: "думаю про смену работы",
        topic: "",
        createdAt: new Date("2024-02-01T00:00:00.000Z"),
      }),
    ]);

    const facts = await store.timeline({ query: "смена работы" });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.text).toContain("смену работы");
  });
});
