import { chunkBase64Audio } from "./audio-chunk.js";
import type { AudioEgressPolicy } from "./audio-egress-policy.js";

/** Decoded byte length of a base64 string (handles padding). */
export function base64DecodedByteLength(b64: string): number {
  if (!b64) return 0;
  const len = b64.length;
  let pad = 0;
  if (b64.endsWith("==")) pad = 2;
  else if (b64.endsWith("=")) pad = 1;
  return Math.floor((len * 3) / 4) - pad;
}

/** PCM16 mono duration in ms for a decoded byte count. */
export function pcm16DurationMs(byteLength: number, sampleRate: number): number {
  if (sampleRate <= 0 || byteLength <= 0) return 0;
  return (byteLength / 2 / sampleRate) * 1000;
}

export type PacedAudioEgressOptions = {
  policy: AudioEgressPolicy;
  sendAudioDelta: (base64Chunk: string) => void;
  /** Injectable clock for tests. */
  nowMs?: () => number;
  sleepMs?: (ms: number) => Promise<void>;
};

/**
 * Forwards base64 PCM16 as `audio.delta` chunks, optionally pacing so
 * cumulative audio duration stays within `maxAheadMs` of wall clock.
 */
export class PacedAudioEgress {
  private readonly policy: AudioEgressPolicy;
  private readonly sendAudioDelta: (base64Chunk: string) => void;
  private readonly nowMs: () => number;
  private readonly sleepMs: (ms: number) => Promise<void>;

  private queue: string[] = [];
  private pumpRunning = false;
  private pcmBytesSent = 0;
  private turnStartedAt: number | null = null;
  private generation = 0;

  constructor(opts: PacedAudioEgressOptions) {
    this.policy = opts.policy;
    this.sendAudioDelta = opts.sendAudioDelta;
    this.nowMs = opts.nowMs ?? (() => Date.now());
    this.sleepMs =
      opts.sleepMs ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Enqueue (or immediately send) Realtime audio delta base64. */
  push(base64Pcm: string): void {
    if (!base64Pcm) return;
    if (this.policy.mode === "none") {
      for (const part of chunkBase64Audio(base64Pcm)) {
        this.sendAudioDelta(part);
      }
      return;
    }
    for (const part of chunkBase64Audio(base64Pcm)) {
      this.queue.push(part);
    }
    void this.pump();
  }

  /** Wait until the pace queue is empty (no-op when mode is none). */
  async flush(): Promise<void> {
    if (this.policy.mode === "none") return;
    while (this.queue.length > 0 || this.pumpRunning) {
      await this.sleepMs(5);
    }
  }

  /** Drop queued audio and reset pacing clock (session end / cancel). */
  clear(): void {
    this.generation += 1;
    this.queue = [];
    this.pcmBytesSent = 0;
    this.turnStartedAt = null;
    this.pumpRunning = false;
  }

  /** Start a new assistant turn clock (optional; first push also starts it). */
  beginTurn(): void {
    if (this.policy.mode === "none") return;
    this.pcmBytesSent = 0;
    this.turnStartedAt = this.nowMs();
  }

  private async pump(): Promise<void> {
    if (this.policy.mode !== "pace_pcm16") return;
    if (this.pumpRunning) return;
    this.pumpRunning = true;
    const gen = this.generation;
    const { sampleRate, maxAheadMs } = this.policy;
    try {
      while (this.queue.length > 0) {
        if (gen !== this.generation) return;
        const part = this.queue.shift()!;
        await this.waitIfAhead(part, sampleRate, maxAheadMs, gen);
        if (gen !== this.generation) return;
        this.sendAudioDelta(part);
        this.pcmBytesSent += base64DecodedByteLength(part);
      }
    } finally {
      if (gen === this.generation) {
        this.pumpRunning = false;
      }
    }
  }

  private async waitIfAhead(
    nextPart: string,
    sampleRate: number,
    maxAheadMs: number,
    gen: number,
  ): Promise<void> {
    if (this.turnStartedAt == null) {
      this.turnStartedAt = this.nowMs();
    }
    const nextBytes = base64DecodedByteLength(nextPart);
    const afterMs = pcm16DurationMs(this.pcmBytesSent + nextBytes, sampleRate);
    const elapsed = this.nowMs() - this.turnStartedAt;
    const ahead = afterMs - elapsed - maxAheadMs;
    if (ahead > 0) {
      await this.sleepMs(ahead);
      if (gen !== this.generation) return;
    }
  }
}
