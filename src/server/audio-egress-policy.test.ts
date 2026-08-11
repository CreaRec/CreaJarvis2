import { afterEach, describe, expect, it } from "vitest";
import {
  audioEgressPolicyForKind,
  DEFAULT_AUDIO_EGRESS_POLICY,
  resetAudioEgressPolicyDefaults,
  setAudioEgressPolicyForKind,
} from "./audio-egress-policy.js";

describe("audioEgressPolicyForKind", () => {
  afterEach(() => {
    resetAudioEgressPolicyDefaults();
  });

  it("defaults to no backpressure for unknown / desktop / pi", () => {
    expect(audioEgressPolicyForKind(undefined)).toEqual(
      DEFAULT_AUDIO_EGRESS_POLICY,
    );
    expect(audioEgressPolicyForKind(null)).toEqual(DEFAULT_AUDIO_EGRESS_POLICY);
    expect(audioEgressPolicyForKind("desktop")).toEqual({ mode: "none" });
    expect(audioEgressPolicyForKind("pi")).toEqual({ mode: "none" });
    expect(audioEgressPolicyForKind("other")).toEqual({ mode: "none" });
  });

  it("paces pcm16 for esp by default", () => {
    expect(audioEgressPolicyForKind("esp")).toEqual({
      mode: "pace_pcm16",
      sampleRate: 24_000,
      maxAheadMs: 3_000,
    });
  });

  it("allows overriding and clearing per kind", () => {
    setAudioEgressPolicyForKind("desktop", {
      mode: "pace_pcm16",
      sampleRate: 24_000,
      maxAheadMs: 1_000,
    });
    expect(audioEgressPolicyForKind("desktop").mode).toBe("pace_pcm16");

    setAudioEgressPolicyForKind("esp", null);
    expect(audioEgressPolicyForKind("esp")).toEqual({ mode: "none" });

    setAudioEgressPolicyForKind("esp", { mode: "none" });
    expect(audioEgressPolicyForKind("esp")).toEqual({ mode: "none" });
  });
});
