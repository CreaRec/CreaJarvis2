import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { AppConfig } from "../config.js";
import { RealtimeClient } from "../realtime/client.js";
import { todayLocalDate } from "../utils/time/index.js";
import { toItemPublic, type PlanStore } from "../plans/store.js";
import type { DeviceRegistry } from "../reminders/device-registry.js";
import { toPublic, type ReminderStore } from "../reminders/store.js";
import type { ToolGateway } from "../tools/gateway.js";
import {
  ACK_PLAY_PROMPT,
  parseClientInbound,
  type ClientInbound,
} from "./voice-protocol.js";

export type ClientOutbound =
  | { type: "hello.ok"; deviceId: string; serverTime: string }
  | { type: "ready" }
  | { type: "audio.delta"; audio: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "response.done" }
  | { type: "tool.status"; tool: string; ok: boolean }
  | { type: "error"; message: string }
  | {
      type: "session.busy";
      ownerDeviceId: string;
      ownerDisplayName?: string;
    }
  | { type: "session.ended"; reason: string }
  | {
      type: "reminder.fired";
      reminder: ReturnType<typeof toPublic>;
    }
  | {
      type: "reminder.missed_digest";
      reminders: Array<ReturnType<typeof toPublic>>;
    }
  | {
      type: "plan.today_digest";
      date: string;
      items: Array<ReturnType<typeof toItemPublic>>;
    };

export type { ClientInbound };

export interface VoiceGatewayDeps {
  config: AppConfig;
  tools: ToolGateway;
  getInstructions: () => Promise<string>;
  deviceRegistry: DeviceRegistry;
  reminderStore: ReminderStore;
  planStore: PlanStore;
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export class VoiceGateway {
  private wss: WebSocketServer | null = null;

  constructor(private readonly deps: VoiceGatewayDeps) {}

  attach(server: import("node:http").Server): void {
    this.wss = new WebSocketServer({ server, path: "/voice" });
    this.wss.on("connection", (socket, req) => {
      void this.handleConnection(socket, req);
    });
  }

  private async flushMissed(): Promise<void> {
    const missed = await this.deps.reminderStore.listMissed(50);
    if (missed.length === 0) return;
    const sent = this.deps.deviceRegistry.broadcast({
      type: "reminder.missed_digest",
      reminders: missed.map(toPublic),
    });
    if (sent === 0) return;
    for (const r of missed) {
      await this.deps.reminderStore.completeDelivery(r.id);
    }
  }

  private async flushTodayPlan(): Promise<void> {
    const day = await this.deps.planStore.listOpenToday();
    const open = day.items.filter((i) => i.status === "open");
    if (open.length === 0) return;
    this.deps.deviceRegistry.broadcast({
      type: "plan.today_digest",
      date: day.localDate || todayLocalDate(this.deps.config.USER_TIMEZONE),
      items: open.map(toItemPublic),
    });
  }

  private async handleConnection(
    socket: WebSocket,
    _req: IncomingMessage,
  ): Promise<void> {
    let realtime: RealtimeClient | null = null;
    let deviceId: string | null = null;
    let helloDone = false;

    const send = (msg: ClientOutbound) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    };

    const ensureRealtime = async () => {
      if (realtime) return realtime;
      const instructions = await this.deps.getInstructions();
      realtime = new RealtimeClient({
        config: this.deps.config,
        instructions,
        tools: this.deps.tools,
        onAudioDelta: (audio) => send({ type: "audio.delta", audio }),
        onTranscript: (role, text) => send({ type: "transcript", role, text }),
        onEvent: (event) => {
          if (String(event.type) !== "response.done") return;
          const response = event.response as
            | { output?: Array<{ type?: string }> }
            | undefined;
          const hasFunctionCall = (response?.output ?? []).some(
            (item) => item.type === "function_call",
          );
          if (!hasFunctionCall) {
            send({ type: "response.done" });
          }
        },
      });
      await realtime.connect();
      send({ type: "ready" });
      return realtime;
    };

    const requireOwner = (): boolean => {
      if (!deviceId || !this.deps.deviceRegistry.isVoiceOwner(deviceId)) {
        send({ type: "error", message: "Not voice owner" });
        return false;
      }
      return true;
    };

    const releaseRealtime = async (reason: string) => {
      if (realtime) {
        await realtime.close();
        realtime = null;
        send({ type: "session.ended", reason });
      }
      if (deviceId) {
        this.deps.deviceRegistry.releaseVoice(deviceId);
      }
    };

    socket.on("message", (data) => {
      void (async () => {
        try {
          let raw: unknown;
          try {
            raw = JSON.parse(data.toString());
          } catch {
            send({ type: "error", message: "Invalid JSON" });
            return;
          }
          const parsed = parseClientInbound(raw);
          if (!parsed.ok) {
            send({ type: "error", message: parsed.error });
            return;
          }
          const msg = parsed.message;

          if (!helloDone) {
            if (msg.type !== "hello") {
              send({ type: "error", message: "hello required first" });
              socket.close();
              return;
            }
            if (!tokensEqual(msg.token, this.deps.config.JARVIS_GATEWAY_TOKEN)) {
              send({ type: "error", message: "Unauthorized" });
              socket.close();
              return;
            }
            const displayName = msg.displayName ?? msg.deviceId;
            this.deps.deviceRegistry.register(
              msg.deviceId,
              socket,
              displayName,
              msg.caps,
            );
            deviceId = msg.deviceId;
            helloDone = true;
            send({
              type: "hello.ok",
              deviceId: msg.deviceId,
              serverTime: new Date().toISOString(),
            });
            try {
              await this.flushMissed();
            } catch (err) {
              console.error("[voice-gateway] missed flush failed:", err);
            }
            try {
              await this.flushTodayPlan();
            } catch (err) {
              console.error("[voice-gateway] plan digest failed:", err);
            }
            return;
          }

          switch (msg.type) {
            case "hello":
              send({ type: "error", message: "already hello'd" });
              break;
            case "session.start": {
              if (!deviceId) {
                send({ type: "error", message: "hello required first" });
                break;
              }
              const claim = this.deps.deviceRegistry.claimVoice(deviceId);
              if (!claim.ok) {
                send({
                  type: "session.busy",
                  ownerDeviceId: claim.ownerDeviceId,
                  ownerDisplayName: claim.ownerDisplayName,
                });
                break;
              }
              await ensureRealtime();
              break;
            }
            case "audio.append": {
              if (!requireOwner()) break;
              const rt = await ensureRealtime();
              rt.appendAudio(msg.audio);
              break;
            }
            case "audio.commit": {
              if (!requireOwner()) break;
              const rt = await ensureRealtime();
              rt.commitAudio();
              break;
            }
            case "text": {
              if (!requireOwner()) break;
              const rt = await ensureRealtime();
              await rt.sendText(msg.text);
              break;
            }
            case "ack.play": {
              if (!requireOwner()) break;
              const rt = await ensureRealtime();
              await rt.playAck(ACK_PLAY_PROMPT);
              break;
            }
            case "session.end":
              await releaseRealtime("session.end");
              break;
            default: {
              const _exhaustive: never = msg;
              void _exhaustive;
              send({ type: "error", message: `Unknown message type` });
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[voice-gateway]", message);
          send({ type: "error", message });
        }
      })();
    });

    socket.on("close", () => {
      const { wasVoiceOwner } = this.deps.deviceRegistry.unregister(socket);
      if (wasVoiceOwner) {
        void realtime?.close();
        realtime = null;
      } else {
        void realtime?.close();
        realtime = null;
      }
    });
  }
}
