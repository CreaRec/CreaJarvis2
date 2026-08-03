/** Shared Voice Gateway inbound parsing (client ↔ core). */

export const ACK_PLAY_PROMPT =
  "Произнеси коротко только: Я тут. Ничего больше не добавляй.";

export type DeviceCaps = {
  voice: boolean;
  notify: boolean;
};

export type ClientInbound =
  | {
      type: "hello";
      token: string;
      deviceId: string;
      displayName?: string;
      caps: DeviceCaps;
    }
  | { type: "session.start" }
  | { type: "audio.append"; audio: string }
  | { type: "audio.commit" }
  | { type: "session.end" }
  | { type: "text"; text: string }
  | { type: "ack.play" };

export type ParseInboundResult =
  | { ok: true; message: ClientInbound }
  | { ok: false; error: string };

function parseCaps(raw: unknown): DeviceCaps | null {
  if (raw == null) {
    return { voice: true, notify: true };
  }
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { voice?: unknown; notify?: unknown };
  if (typeof c.voice !== "boolean" || typeof c.notify !== "boolean") {
    return null;
  }
  return { voice: c.voice, notify: c.notify };
}

export function parseClientInbound(raw: unknown): ParseInboundResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid message" };
  }
  const msg = raw as {
    type?: unknown;
    audio?: unknown;
    text?: unknown;
    token?: unknown;
    deviceId?: unknown;
    displayName?: unknown;
    caps?: unknown;
  };
  const type = msg.type;
  if (typeof type !== "string") {
    return { ok: false, error: "Missing message type" };
  }
  switch (type) {
    case "hello": {
      if (typeof msg.token !== "string" || !msg.token) {
        return { ok: false, error: "hello missing token" };
      }
      if (typeof msg.deviceId !== "string" || !msg.deviceId.trim()) {
        return { ok: false, error: "hello missing deviceId" };
      }
      const caps = parseCaps(msg.caps);
      if (!caps) {
        return { ok: false, error: "hello invalid caps" };
      }
      const displayName =
        typeof msg.displayName === "string" && msg.displayName.trim()
          ? msg.displayName.trim()
          : undefined;
      return {
        ok: true,
        message: {
          type: "hello",
          token: msg.token,
          deviceId: msg.deviceId.trim(),
          ...(displayName ? { displayName } : {}),
          caps,
        },
      };
    }
    case "session.start":
    case "audio.commit":
    case "session.end":
    case "ack.play":
      return { ok: true, message: { type } };
    case "audio.append":
      if (typeof msg.audio !== "string" || !msg.audio) {
        return { ok: false, error: "audio.append missing audio" };
      }
      return { ok: true, message: { type: "audio.append", audio: msg.audio } };
    case "text":
      if (typeof msg.text !== "string") {
        return { ok: false, error: "text missing text" };
      }
      return { ok: true, message: { type: "text", text: msg.text } };
    default:
      return { ok: false, error: `Unknown message type` };
  }
}
