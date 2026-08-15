import { describe, expect, it, vi } from "vitest";
import {
  MemoryAgentSessionStore,
  RedisAgentSessionStore,
  sessionKey,
  type RedisCommands,
} from "./session-store.js";

describe("MemoryAgentSessionStore", () => {
  it("appends turns, trims to max, and clears", async () => {
    const store = new MemoryAgentSessionStore({
      ttlSeconds: 1800,
      maxMessages: 4,
    });
    await store.appendTurn("u1", "a", "A");
    await store.appendTurn("u1", "b", "B");
    await store.appendTurn("u1", "c", "C");
    const messages = await store.getMessages("u1");
    expect(messages).toEqual([
      { role: "user", content: "b" },
      { role: "assistant", content: "B" },
      { role: "user", content: "c" },
      { role: "assistant", content: "C" },
    ]);
    await store.clear("u1");
    expect(await store.getMessages("u1")).toEqual([]);
  });

  it("expires idle sessions via clock", async () => {
    let now = 1_000_000;
    const store = new MemoryAgentSessionStore({
      ttlSeconds: 10,
      maxMessages: 12,
      now: () => now,
    });
    await store.appendTurn("u1", "hi", "hello");
    expect(await store.getMessages("u1")).toHaveLength(2);
    now += 11_000;
    expect(await store.getMessages("u1")).toEqual([]);
  });
});

describe("RedisAgentSessionStore", () => {
  it("loads, appends with EX, and clears", async () => {
    const data = new Map<string, string>();
    const redis: RedisCommands = {
      get: vi.fn(async (key) => data.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        data.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key) => {
        const had = data.delete(key);
        return had ? 1 : 0;
      }),
    };
    const store = new RedisAgentSessionStore(redis, {
      ttlSeconds: 1800,
      maxMessages: 12,
    });

    expect(await store.getMessages("42")).toEqual([]);
    await store.appendTurn("42", "привет", "ответ");
    expect(redis.set).toHaveBeenCalledWith(
      sessionKey("42"),
      JSON.stringify([
        { role: "user", content: "привет" },
        { role: "assistant", content: "ответ" },
      ]),
      { EX: 1800 },
    );
    expect(await store.getMessages("42")).toEqual([
      { role: "user", content: "привет" },
      { role: "assistant", content: "ответ" },
    ]);
    await store.clear("42");
    expect(redis.del).toHaveBeenCalledWith(sessionKey("42"));
    expect(await store.getMessages("42")).toEqual([]);
  });

  it("returns empty on get failure (fail-soft)", async () => {
    const redis: RedisCommands = {
      get: vi.fn(async () => {
        throw new Error("down");
      }),
      set: vi.fn(async () => "OK"),
      del: vi.fn(async () => 0),
    };
    const store = new RedisAgentSessionStore(redis, {
      ttlSeconds: 60,
      maxMessages: 4,
    });
    expect(await store.getMessages("1")).toEqual([]);
  });
});
