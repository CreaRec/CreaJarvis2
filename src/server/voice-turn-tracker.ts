import { logger } from "../log.js";

export type VoiceTurnKind = "audio" | "text" | "ack";

/**
 * Tracks one voice turn (audio commit / text / ack) for start→finish logs
 * with duration_ms. Safe to call finish without begin (no-op).
 */
export class VoiceTurnTracker {
  private startedAt: number | null = null;
  private kind: VoiceTurnKind | null = null;

  constructor(private readonly deviceId?: () => string | null) {}

  begin(kind: VoiceTurnKind): void {
    this.startedAt = Date.now();
    this.kind = kind;
  }

  /** @returns true when an open turn was closed */
  finish(step: string): boolean {
    if (this.startedAt == null) return false;
    const durationMs = Date.now() - this.startedAt;
    const deviceId = this.deviceId?.() ?? null;
    logger.info("[voice] turn finished", {
      component: "voice",
      handler: "session",
      step,
      result: "success",
      duration_ms: durationMs,
      turn: this.kind ?? "unknown",
      ...(deviceId ? { device_id: deviceId } : {}),
    });
    this.clear();
    return true;
  }

  clear(): void {
    this.startedAt = null;
    this.kind = null;
  }
}
