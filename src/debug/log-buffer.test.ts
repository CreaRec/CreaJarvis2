import { describe, expect, it } from "vitest";
import { LogBuffer, installConsoleCapture } from "./log-buffer.js";

describe("LogBuffer", () => {
  it("appends entries with monotonic ids", () => {
    const buf = new LogBuffer(10);
    const a = buf.append("log", "one");
    const b = buf.append("warn", "two");
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(buf.list()).toEqual([a, b]);
  });

  it("evicts oldest when over capacity", () => {
    const buf = new LogBuffer(2);
    buf.append("log", "a");
    buf.append("log", "b");
    buf.append("log", "c");
    const rows = buf.list();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.message)).toEqual(["b", "c"]);
  });

  it("filters by afterId and limit", () => {
    const buf = new LogBuffer(10);
    buf.append("log", "a");
    buf.append("log", "b");
    buf.append("log", "c");
    expect(buf.list({ afterId: 1 }).map((r) => r.message)).toEqual(["b", "c"]);
    expect(buf.list({ afterId: 0, limit: 2 }).map((r) => r.message)).toEqual([
      "b",
      "c",
    ]);
  });

  it("clear empties the buffer", () => {
    const buf = new LogBuffer(5);
    buf.append("log", "x");
    buf.clear();
    expect(buf.list()).toEqual([]);
    expect(buf.size).toBe(0);
  });
});

describe("installConsoleCapture", () => {
  it("mirrors console output into the buffer and restores", () => {
    const buf = new LogBuffer(20);
    const calls: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      calls.push(args);
    };

    const restore = installConsoleCapture(buf);
    try {
      console.warn("hello", 42);
      expect(calls).toEqual([["hello", 42]]);
      expect(buf.list()).toHaveLength(1);
      expect(buf.list()[0]).toMatchObject({
        level: "warn",
        message: "hello 42",
      });
    } finally {
      restore();
      console.warn = originalWarn;
    }

    expect(console.warn).toBe(originalWarn);
  });
});
