import { describe, expect, it } from "vitest";
import {
  base64DecodedByteLength,
  PacedAudioEgress,
  pcm16DurationMs,
} from "./paced-audio-egress.js";

/** PCM16 @ 24kHz as base64; `seconds` of audio. */
function pcmBase64Seconds(seconds: number, sampleRate = 24_000): string {
  const bytes = Math.round(seconds * sampleRate * 2);
  return Buffer.alloc(bytes, 1).toString("base64");
}

describe("pcm helpers", () => {
  it("computes base64 decoded length with padding", () => {
    expect(base64DecodedByteLength(Buffer.from([1, 2, 3]).toString("base64"))).toBe(
      3,
    );
    expect(base64DecodedByteLength(Buffer.from([1, 2]).toString("base64"))).toBe(2);
  });

  it("computes pcm16 duration", () => {
    expect(pcm16DurationMs(48_000, 24_000)).toBe(1000);
    expect(pcm16DurationMs(0, 24_000)).toBe(0);
  });
});

describe("PacedAudioEgress", () => {
  it("sends immediately when policy is none", async () => {
    const sent: string[] = [];
    const egress = new PacedAudioEgress({
      policy: { mode: "none" },
      sendAudioDelta: (a) => sent.push(a),
    });
    const audio = pcmBase64Seconds(0.05);
    egress.push(audio);
    expect(sent.join("")).toBe(audio);
    await egress.flush();
  });

  it("paces so cumulative audio stays within maxAheadMs", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const sent: string[] = [];
    const egress = new PacedAudioEgress({
      policy: {
        mode: "pace_pcm16",
        sampleRate: 24_000,
        maxAheadMs: 100,
      },
      sendAudioDelta: (a) => sent.push(a),
      nowMs: () => now,
      sleepMs: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    egress.beginTurn();
    egress.push(pcmBase64Seconds(0.5));
    await egress.flush();

    expect(sent.length).toBeGreaterThan(0);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(350);
    expect(now).toBeGreaterThanOrEqual(350);
  });

  it("clear drops the remaining queue", async () => {
    let now = 0;
    let cleared = false;
    const sent: string[] = [];
    const egress = new PacedAudioEgress({
      policy: {
        mode: "pace_pcm16",
        sampleRate: 24_000,
        maxAheadMs: 0,
      },
      sendAudioDelta: (a) => {
        sent.push(a);
        if (!cleared) {
          cleared = true;
          egress.clear();
        }
      },
      nowMs: () => now,
      sleepMs: async (ms) => {
        now += ms;
      },
    });
    egress.push(pcmBase64Seconds(2));
    await egress.flush();
    expect(sent.length).toBe(1);
  });

  it("flush resolves for empty paced queue", async () => {
    const egress = new PacedAudioEgress({
      policy: {
        mode: "pace_pcm16",
        sampleRate: 24_000,
        maxAheadMs: 1000,
      },
      sendAudioDelta: () => undefined,
      sleepMs: async () => undefined,
    });
    await expect(egress.flush()).resolves.toBeUndefined();
  });
});
