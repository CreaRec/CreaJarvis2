import { describe, expect, it } from "vitest";
import {
  ACK_PLAY_PROMPT,
  parseClientInbound,
} from "./voice-protocol.js";

describe("parseClientInbound", () => {
  it("parses hello with caps", () => {
    expect(
      parseClientInbound({
        type: "hello",
        token: "secret",
        deviceId: "dev-1",
        displayName: "Mac",
        room: "кабинет",
        purpose: "работа",
        kind: "desktop",
        caps: { voice: true, notify: false },
      }),
    ).toEqual({
      ok: true,
      message: {
        type: "hello",
        token: "secret",
        deviceId: "dev-1",
        displayName: "Mac",
        room: "office",
        purpose: "работа",
        kind: "desktop",
        caps: { voice: true, notify: false },
      },
    });
  });

  it("normalizes room aliases to catalog ids", () => {
    expect(
      parseClientInbound({
        type: "hello",
        token: "t",
        deviceId: "d",
        room: "Kitchen",
      }),
    ).toEqual({
      ok: true,
      message: expect.objectContaining({ room: "kitchen_living" }),
    });
  });

  it("rejects hello with invalid room", () => {
    expect(
      parseClientInbound({
        type: "hello",
        token: "t",
        deviceId: "d",
        room: "basement",
      }),
    ).toEqual({ ok: false, error: "hello invalid room" });
  });

  it("rejects hello with invalid kind", () => {
    expect(
      parseClientInbound({
        type: "hello",
        token: "t",
        deviceId: "d",
        kind: "phone",
      }),
    ).toEqual({ ok: false, error: "hello invalid kind" });
  });

  it("defaults hello caps when omitted", () => {
    const parsed = parseClientInbound({
      type: "hello",
      token: "secret",
      deviceId: "  dev-2  ",
    });
    expect(parsed).toEqual({
      ok: true,
      message: {
        type: "hello",
        token: "secret",
        deviceId: "dev-2",
        caps: { voice: true, notify: true },
      },
    });
  });

  it("rejects hello without token or deviceId", () => {
    expect(parseClientInbound({ type: "hello", deviceId: "x" })).toEqual({
      ok: false,
      error: "hello missing token",
    });
    expect(parseClientInbound({ type: "hello", token: "t" })).toEqual({
      ok: false,
      error: "hello missing deviceId",
    });
  });

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
