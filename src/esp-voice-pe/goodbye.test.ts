import { describe, expect, it } from "vitest";
import { ESP_VAD, isGoodbyeUtterance, normalizeUtterance } from "./goodbye.js";

describe("esp-voice-pe goodbye", () => {
  it("detects russian and english farewells", () => {
    expect(isGoodbyeUtterance("Спасибо Джарвис")).toBe(true);
    expect(isGoodbyeUtterance("пока джарвис")).toBe(true);
    expect(isGoodbyeUtterance("bye jarvis")).toBe(true);
  });

  it("rejects commands that only mention thanks", () => {
    expect(isGoodbyeUtterance("спасибо джарвис поставь таймер на 5 минут")).toBe(
      false,
    );
    expect(isGoodbyeUtterance("какой сегодня день")).toBe(false);
  });

  it("normalizes yo and punctuation", () => {
    expect(normalizeUtterance("Ёлка!")).toBe("елка");
  });
});

describe("esp-voice-pe VAD constants", () => {
  it("matches desktop FSM", () => {
    expect(ESP_VAD.SILENCE_EOS_MS).toBe(700);
    expect(ESP_VAD.MIN_UTTERANCE_MS).toBe(250);
    expect(ESP_VAD.SPEECH_RMS_THRESHOLD).toBe(500);
    expect(ESP_VAD.TARGET_RATE).toBe(24_000);
  });
});
