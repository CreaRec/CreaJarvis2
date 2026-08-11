import { describe, expect, it } from "vitest";
import { INPUT_AUDIO_TRANSCRIPTION } from "./client.js";

describe("INPUT_AUDIO_TRANSCRIPTION", () => {
  it("biases ASR to Russian with Jarvis goodbye keywords", () => {
    expect(INPUT_AUDIO_TRANSCRIPTION.model).toBe("gpt-4o-mini-transcribe");
    expect(INPUT_AUDIO_TRANSCRIPTION.language).toBe("ru");
    expect(INPUT_AUDIO_TRANSCRIPTION.prompt).toMatch(/Джарвис/);
    expect(INPUT_AUDIO_TRANSCRIPTION.prompt).toMatch(/пока/);
  });
});
