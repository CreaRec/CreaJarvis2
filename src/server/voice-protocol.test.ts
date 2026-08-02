import { describe, expect, it } from "vitest";
import {
  ACK_PLAY_PROMPT,
  parseClientInbound,
} from "./voice-protocol.js";

describe("parseClientInbound", () => {
  it("parses ack.play", () => {
    expect(parseClientInbound({ type: "ack.play" })).toEqual({
      ok: true,
      message: { type: "ack.play" },
    });
  });

  it("parses session lifecycle and audio", () => {
    expect(parseClientInbound({ type: "session.start" }).ok).toBe(true);
    expect(parseClientInbound({ type: "session.end" }).ok).toBe(true);
    expect(parseClientInbound({ type: "audio.commit" }).ok).toBe(true);
    expect(
      parseClientInbound({ type: "audio.append", audio: "AAAA" }),
    ).toEqual({
      ok: true,
      message: { type: "audio.append", audio: "AAAA" },
    });
  });

  it("rejects audio.append without audio", () => {
    expect(parseClientInbound({ type: "audio.append" })).toEqual({
      ok: false,
      error: "audio.append missing audio",
    });
  });

  it("rejects unknown types", () => {
    expect(parseClientInbound({ type: "nope" })).toEqual({
      ok: false,
      error: "Unknown message type",
    });
  });
});

describe("ACK_PLAY_PROMPT", () => {
  it("asks for short Я тут only", () => {
    expect(ACK_PLAY_PROMPT).toContain("Я тут");
    expect(ACK_PLAY_PROMPT.length).toBeLessThan(120);
  });
});
