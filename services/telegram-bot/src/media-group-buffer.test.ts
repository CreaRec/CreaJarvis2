import { describe, expect, it, vi } from "vitest";
import { MediaGroupBuffer } from "./media-group-buffer.js";

describe("MediaGroupBuffer", () => {
  it("coalesces items after debounce", async () => {
    const flushed: number[][] = [];
    const buf = new MediaGroupBuffer<number>(30, async (_key, items) => {
      flushed.push(items);
    });
    buf.push("g1", 1);
    buf.push("g1", 2);
    buf.push("g1", 3);
    await new Promise((r) => setTimeout(r, 80));
    expect(flushed).toEqual([[1, 2, 3]]);
  });
});
