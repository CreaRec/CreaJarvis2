import { describe, expect, it } from "vitest";
import {
  isRealtimeNotOpenError,
  RealtimeNotOpenError,
} from "./client.js";

describe("RealtimeNotOpenError", () => {
  it("is detected via helper", () => {
    expect(isRealtimeNotOpenError(new RealtimeNotOpenError())).toBe(true);
  });

  it("matches legacy Error message from older Core", () => {
    expect(
      isRealtimeNotOpenError(new Error("Realtime WebSocket is not open")),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isRealtimeNotOpenError(new Error("boom"))).toBe(false);
    expect(isRealtimeNotOpenError("Realtime WebSocket is not open")).toBe(
      false,
    );
  });
});
