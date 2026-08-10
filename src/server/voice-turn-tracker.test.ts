import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logApi = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock("../log.js", () => ({
  logger: logApi,
  truncateForLog: (t: string) => t,
}));

describe("VoiceTurnTracker", () => {
  beforeEach(() => {
    vi.resetModules();
    logApi.info.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T03:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records duration between turn start and response_done", async () => {
    const { VoiceTurnTracker } = await import("./voice-turn-tracker.js");
    const turns = new VoiceTurnTracker(() => "desk-1");

    turns.begin("audio");
    vi.advanceTimersByTime(1250);
    expect(turns.finish("response_done")).toBe(true);

    expect(logApi.info).toHaveBeenCalledWith(
      "[voice] turn finished",
      expect.objectContaining({
        step: "response_done",
        turn: "audio",
        duration_ms: 1250,
        result: "success",
        device_id: "desk-1",
      }),
    );
  });

  it("ignores finish without an open turn", async () => {
    const { VoiceTurnTracker } = await import("./voice-turn-tracker.js");
    const turns = new VoiceTurnTracker();
    expect(turns.finish("response_done")).toBe(false);
    expect(logApi.info).not.toHaveBeenCalled();
  });
});
