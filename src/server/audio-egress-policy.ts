import type { DeviceKind } from "./voice-protocol.js";

/**
 * How Core pushes `audio.delta` to a voice client.
 * Default is firehose (`none`). Device kinds may opt into pacing so slow
 * players (e.g. ESP ring buffers) are not flooded faster than realtime.
 */
export type AudioEgressPolicy =
  | { mode: "none" }
  | {
      mode: "pace_pcm16";
      /** PCM sample rate of Realtime output (Hz). */
      sampleRate: number;
      /**
       * How far ahead of wall-clock playback we may send (ms).
       * Keeps a small cushion on-device without filling the whole ring.
       */
      maxAheadMs: number;
    };

export const DEFAULT_AUDIO_EGRESS_POLICY: AudioEgressPolicy = { mode: "none" };

/** Built-in kind overrides; mutable via {@link setAudioEgressPolicyForKind}. */
const kindOverrides: Partial<Record<DeviceKind, AudioEgressPolicy>> = {
  esp: {
    mode: "pace_pcm16",
    sampleRate: 24_000,
    maxAheadMs: 3_000,
  },
};

export function audioEgressPolicyForKind(
  kind: DeviceKind | null | undefined,
): AudioEgressPolicy {
  if (!kind) return DEFAULT_AUDIO_EGRESS_POLICY;
  return kindOverrides[kind] ?? DEFAULT_AUDIO_EGRESS_POLICY;
}

/**
 * Override egress policy for a device kind (or clear with `null` to fall back
 * to {@link DEFAULT_AUDIO_EGRESS_POLICY}). Useful for tests and future per-fleet tuning.
 */
export function setAudioEgressPolicyForKind(
  kind: DeviceKind,
  policy: AudioEgressPolicy | null,
): void {
  if (policy == null) {
    delete kindOverrides[kind];
    return;
  }
  kindOverrides[kind] = policy;
}

/** Test helper: restore built-in defaults (esp paced, others none). */
export function resetAudioEgressPolicyDefaults(): void {
  for (const key of Object.keys(kindOverrides) as DeviceKind[]) {
    delete kindOverrides[key];
  }
  kindOverrides.esp = {
    mode: "pace_pcm16",
    sampleRate: 24_000,
    maxAheadMs: 3_000,
  };
}
