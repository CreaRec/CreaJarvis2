/** Shared Voice Gateway inbound parsing (client ↔ core). */

export const ACK_PLAY_PROMPT =
  "Произнеси коротко только: Я тут. Ничего больше не добавляй.";

export type ClientInbound =
  | { type: "session.start" }
  | { type: "audio.append"; audio: string }
  | { type: "audio.commit" }
  | { type: "session.end" }
  | { type: "text"; text: string }
  | { type: "ack.play" };

export type ParseInboundResult =
  | { ok: true; message: ClientInbound }
  | { ok: false; error: string };

export function parseClientInbound(raw: unknown): ParseInboundResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid message" };
  }
  const msg = raw as { type?: unknown; audio?: unknown; text?: unknown };
  const type = msg.type;
  if (typeof type !== "string") {
    return { ok: false, error: "Missing message type" };
  }
  switch (type) {
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
