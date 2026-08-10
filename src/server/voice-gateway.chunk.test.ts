import { describe, expect, it } from "vitest";
import { chunkBase64Audio } from "./voice-gateway.js";

describe("chunkBase64Audio", () => {
  it("returns single chunk when short", () => {
    expect(chunkBase64Audio("abcd", 4096)).toEqual(["abcd"]);
  });

  it("splits on multiple of 4", () => {
    const input = "A".repeat(10);
    const parts = chunkBase64Audio(input, 8);
    expect(parts.every((p) => p.length % 4 === 0 || p === parts.at(-1))).toBe(true);
    expect(parts.join("")).toBe(input);
    expect(parts[0].length).toBe(8);
  });

  it("uses 4096 default aligned size", () => {
    const input = "B".repeat(5000);
    const parts = chunkBase64Audio(input);
    expect(parts[0].length).toBe(4096);
    expect(parts.join("")).toBe(input);
  });
});
