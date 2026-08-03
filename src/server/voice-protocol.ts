/** Shared Voice Gateway inbound parsing (client ↔ core). */

import { normalizeRoom, type DeviceRoomId } from "../devices/rooms.js";

export const ACK_PLAY_PROMPT =
  "Произнеси коротко только: Я тут. Ничего больше не добавляй.";

export type DeviceCaps = {
  voice: boolean;
  notify: boolean;
};

export type DeviceKind = "desktop" | "pi" | "esp" | "other";

const DEVICE_KINDS = new Set<DeviceKind>(["desktop", "pi", "esp", "other"]);

export type ClientInbound =
  | {
      type: "hello";
      token: string;
      deviceId: string;
      displayName?: string;
      room?: DeviceRoomId;
      purpose?: string;
      kind?: DeviceKind;
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

function optionalTrimmed(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t ? t : undefined;
}

function parseKind(raw: unknown): DeviceKind | undefined | null {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return null;
  const t = raw.trim() as DeviceKind;
  if (!DEVICE_KINDS.has(t)) return null;
  return t;
}

function parseRoom(raw: unknown): DeviceRoomId | undefined | null {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return null;
  return normalizeRoom(raw);
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
    room?: unknown;
    purpose?: unknown;
    kind?: unknown;
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
      const kind = parseKind(msg.kind);
      if (kind === null) {
        return { ok: false, error: "hello invalid kind" };
      }
      const room = parseRoom(msg.room);
      if (room === null) {
        return { ok: false, error: "hello invalid room" };
      }
      const displayName = optionalTrimmed(msg.displayName);
      const purpose = optionalTrimmed(msg.purpose);
      return {
        ok: true,
        message: {
          type: "hello",
          token: msg.token,
          deviceId: msg.deviceId.trim(),
          ...(displayName ? { displayName } : {}),
          ...(room ? { room } : {}),
          ...(purpose ? { purpose } : {}),
          ...(kind ? { kind } : {}),
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
