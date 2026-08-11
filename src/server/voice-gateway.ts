import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { SpanStatusCode } from "@opentelemetry/api";
import { WebSocket, WebSocketServer } from "ws";
import type { AppConfig } from "../config.js";
import {
  formatDeviceSessionBlock,
  type DeviceStore,
} from "../devices/store.js";
import { logger, truncateForLog } from "../log.js";
import {
  isRealtimeNotOpenError,
  RealtimeClient,
} from "../realtime/client.js";
import {
  classifyError,
  recordHandledSession,
  recordVoiceError,
  withVoiceSessionSpan,
  type VoiceResult,
} from "../telemetry.js";
import { todayLocalDate } from "../utils/time/index.js";
import { toItemPublic, type PlanStore } from "../plans/store.js";
import type { DeviceRegistry } from "../reminders/device-registry.js";
import { toPublic, type ReminderStore } from "../reminders/store.js";
import type { ToolGateway } from "../tools/gateway.js";
import { audioEgressPolicyForKind } from "./audio-egress-policy.js";
import { PacedAudioEgress } from "./paced-audio-egress.js";
import {
  ACK_PLAY_PROMPT,
  parseClientInbound,
  type ClientInbound,
  type DeviceKind,
} from "./voice-protocol.js";
import { VoiceTurnTracker } from "./voice-turn-tracker.js";

export { chunkBase64Audio } from "./audio-chunk.js";

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

/**
 * Send `ready` only once per voice session (PE → ack.play).
 * Mid-session Realtime reconnect must not re-announce.
 */
export function shouldAnnounceRealtimeReady(alreadyAnnounced: boolean): boolean {
  return !alreadyAnnounced;
}

export interface VoiceGatewayDeps {
  config: AppConfig;
  tools: ToolGateway;
  getInstructions: () => Promise<string>;
  deviceRegistry: DeviceRegistry;
  deviceStore: DeviceStore;
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

  private async instructionsForDevice(deviceId: string): Promise<string> {
    const base = await this.deps.getInstructions();
    const [current, siblings] = await Promise.all([
      this.deps.deviceStore.get(deviceId),
      this.deps.deviceStore.list({ limit: 50 }),
    ]);
    const block = formatDeviceSessionBlock({
      current,
      onlineIds: this.deps.deviceRegistry.onlineIds(),
      siblings,
    });
    return `${base}\n\n${block}`;
  }

  private async handleConnection(
    socket: WebSocket,
    _req: IncomingMessage,
  ): Promise<void> {
    let realtime: RealtimeClient | null = null;
    let realtimeReadyAnnounced = false;
    let deviceId: string | null = null;
    let deviceKind: DeviceKind | null = null;
    let audioEgress: PacedAudioEgress | null = null;
    let helloDone = false;
    let sessionStartedAt: number | null = null;
    let sessionResult: VoiceResult = "success";
    let sessionRecorded = false;
    const turns = new VoiceTurnTracker(() => deviceId);

    const send = (msg: ClientOutbound) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    };

    const ensureAudioEgress = (): PacedAudioEgress => {
      if (!audioEgress) {
        const policy = audioEgressPolicyForKind(deviceKind);
        if (policy.mode !== "none") {
          logger.info("[voice] audio egress pacing enabled", {
            component: "voice",
            handler: "session",
            step: "audio_egress",
            device_kind: deviceKind ?? "unknown",
            max_ahead_ms: policy.maxAheadMs,
            sample_rate: policy.sampleRate,
            ...(deviceId ? { device_id: deviceId } : {}),
          });
        }
        audioEgress = new PacedAudioEgress({
          policy,
          sendAudioDelta: (audio) => send({ type: "audio.delta", audio }),
        });
      }
      return audioEgress;
    };

    const finishSessionMetrics = (reason: string) => {
      if (sessionStartedAt == null || sessionRecorded) return;
      sessionRecorded = true;
      const durationSeconds = (Date.now() - sessionStartedAt) / 1000;
      recordHandledSession({
        result: sessionResult,
        durationSeconds,
        handler: "session",
      });
      logger.info("[voice] session finished", {
        component: "voice",
        handler: "session",
        step: "finish",
        result: sessionResult,
        duration_ms: Math.round(durationSeconds * 1000),
        reason,
        ...(deviceId ? { device_id: deviceId } : {}),
      });
      sessionStartedAt = null;
      turns.clear();
      audioEgress?.clear();
    };

    const ensureRealtime = async () => {
      if (realtime?.isOpen()) return realtime;

      if (realtime) {
        logger.warn("[voice] realtime socket dead — reconnecting", {
          component: "voice",
          handler: "realtime",
          step: "reconnect",
          ...(deviceId ? { device_id: deviceId } : {}),
        });
        try {
          await realtime.close();
        } catch {
          // ignore close races
        }
        realtime = null;
      }

      if (!deviceId) {
        throw new Error("deviceId required before Realtime");
      }
      const instructions = await this.instructionsForDevice(deviceId);
      realtime = new RealtimeClient({
        config: this.deps.config,
        instructions,
        tools: this.deps.tools,
        onAudioDelta: (audio) => {
          ensureAudioEgress().push(audio);
        },
        onTranscript: (role, text) => {
          if (role === "user") {
            logger.info("[voice] user transcript", {
              component: "voice",
              handler: "session",
              step: "transcript",
              text_chars: text.length,
              user_text: truncateForLog(text),
              ...(deviceId ? { device_id: deviceId } : {}),
            });
          }
          send({ type: "transcript", role, text });
        },
        onEvent: async (event) => {
          if (String(event.type) !== "response.done") return;
          const response = event.response as
            | { output?: Array<{ type?: string }> }
            | undefined;
          const hasFunctionCall = (response?.output ?? []).some(
            (item) => item.type === "function_call",
          );
          if (!hasFunctionCall) {
            // Wait for paced audio to leave Core before signaling done to client.
            await ensureAudioEgress().flush();
            turns.finish("response_done");
            send({ type: "response.done" });
          }
        },
      });
      await realtime.connect();
      // First successful connect in a voice session: PE waits for ready → ack.
      // Mid-session reconnect must not re-announce (would restart ack FSM).
      if (shouldAnnounceRealtimeReady(realtimeReadyAnnounced)) {
        realtimeReadyAnnounced = true;
        send({ type: "ready" });
      }
      return realtime;
    };

    const dropDeadRealtime = async () => {
      if (!realtime) return;
      try {
        await realtime.close();
      } catch {
        // ignore
      }
      realtime = null;
    };

    const requireOwner = (): boolean => {
      if (!deviceId || !this.deps.deviceRegistry.isVoiceOwner(deviceId)) {
        send({ type: "error", message: "Not voice owner" });
        return false;
      }
      return true;
    };

    const releaseRealtime = async (reason: string) => {
      audioEgress?.clear();
      if (realtime) {
        await realtime.close();
        realtime = null;
        send({ type: "session.ended", reason });
      }
      realtimeReadyAnnounced = false;
      if (deviceId) {
        this.deps.deviceRegistry.releaseVoice(deviceId);
      }
      finishSessionMetrics(reason);
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
              recordHandledSession({
                result: "skipped",
                durationSeconds: 0,
                handler: "hello",
              });
              logger.warn("[voice] hello unauthorized", {
                component: "voice",
                handler: "hello",
                step: "auth",
                result: "skipped",
                error_type: "auth",
                device_id: msg.deviceId,
              });
              send({ type: "error", message: "Unauthorized" });
              socket.close();
              return;
            }
            const saved = await this.deps.deviceStore.upsertFromHello({
              deviceId: msg.deviceId,
              displayName: msg.displayName,
              room: msg.room,
              purpose: msg.purpose,
              kind: msg.kind,
              caps: msg.caps,
            });
            this.deps.deviceRegistry.register(
              saved.id,
              socket,
              saved.displayName,
              msg.caps,
              { room: saved.room, purpose: saved.purpose },
            );
            deviceId = saved.id;
            deviceKind = saved.kind;
            audioEgress = null; // recreate with kind policy on next audio
            helloDone = true;
            logger.info("[voice] hello ok", {
              component: "voice",
              handler: "hello",
              step: "start",
              result: "success",
              device_id: saved.id,
            });
            send({
              type: "hello.ok",
              deviceId: saved.id,
              serverTime: new Date().toISOString(),
            });
            try {
              await this.flushMissed();
            } catch (err) {
              logger.exception("[voice] missed flush failed", err, {
                component: "voice",
                handler: "hello",
                step: "missed_flush",
                result: "error",
                error_type: classifyError(err),
              });
            }
            try {
              await this.flushTodayPlan();
            } catch (err) {
              logger.exception("[voice] plan digest failed", err, {
                component: "voice",
                handler: "hello",
                step: "plan_digest",
                result: "error",
                error_type: classifyError(err),
              });
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
                recordHandledSession({
                  result: "skipped",
                  durationSeconds: 0,
                  handler: "session",
                });
                logger.info("[voice] session busy", {
                  component: "voice",
                  handler: "session",
                  step: "start",
                  result: "skipped",
                  device_id: deviceId,
                  owner_device_id: claim.ownerDeviceId,
                });
                send({
                  type: "session.busy",
                  ownerDeviceId: claim.ownerDeviceId,
                  ownerDisplayName: claim.ownerDisplayName,
                });
                break;
              }
              sessionStartedAt = Date.now();
              sessionResult = "success";
              sessionRecorded = false;
              realtimeReadyAnnounced = false;
              audioEgress?.clear();
              audioEgress = null;
              await withVoiceSessionSpan(
                "voice.session",
                { device_id: deviceId, handler: "session" },
                async (span) => {
                  logger.info("[voice] session started", {
                    component: "voice",
                    handler: "session",
                    step: "start",
                    device_id: deviceId!,
                  });
                  try {
                    await ensureRealtime();
                  } catch (err) {
                    sessionResult = "error";
                    const errorType = classifyError(err);
                    recordVoiceError({ errorType, handler: "realtime" });
                    span.recordException(
                      err instanceof Error ? err : new Error(String(err)),
                    );
                    span.setStatus({
                      code: SpanStatusCode.ERROR,
                      message: err instanceof Error ? err.message : String(err),
                    });
                    this.deps.deviceRegistry.releaseVoice(deviceId!);
                    finishSessionMetrics("realtime_connect_failed");
                    throw err;
                  }
                },
              );
              break;
            }
            case "audio.append": {
              if (!requireOwner()) break;
              // Do not reconnect on every mic chunk (OpenAI handshake is heavy).
              // If RT died after ack, drop uplink until commit/text/ack reconnects.
              if (!realtime?.isOpen()) {
                break;
              }
              try {
                realtime.appendAudio(msg.audio);
              } catch (err) {
                if (!isRealtimeNotOpenError(err)) throw err;
                logger.warn("[voice] drop audio.append — realtime not open", {
                  component: "voice",
                  handler: "session",
                  step: "audio_append",
                  result: "skipped",
                  error_type: "openai",
                  ...(deviceId ? { device_id: deviceId } : {}),
                });
                await dropDeadRealtime();
              }
              break;
            }
            case "audio.commit": {
              if (!requireOwner()) break;
              const rt = await ensureRealtime();
              ensureAudioEgress().beginTurn();
              turns.begin("audio");
              logger.info("[voice] turn started", {
                component: "voice",
                handler: "session",
                step: "commit",
                turn: "audio",
                device_id: deviceId!,
              });
              rt.commitAudio();
              break;
            }
            case "text": {
              if (!requireOwner()) break;
              const rt = await ensureRealtime();
              ensureAudioEgress().beginTurn();
              turns.begin("text");
              logger.info("[voice] turn started", {
                component: "voice",
                handler: "session",
                step: "text",
                turn: "text",
                device_id: deviceId!,
                text_chars: msg.text.length,
                user_text: truncateForLog(msg.text),
              });
              await rt.sendText(msg.text);
              break;
            }
            case "ack.play": {
              if (!requireOwner()) break;
              const rt = await ensureRealtime();
              ensureAudioEgress().beginTurn();
              turns.begin("ack");
              logger.info("[voice] ack", {
                component: "voice",
                handler: "session",
                step: "ack",
                turn: "ack",
                device_id: deviceId!,
              });
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
          // Dead Realtime must not paint PE red or fail the session metrics;
          // next commit/text/ack will reconnect via ensureRealtime.
          if (isRealtimeNotOpenError(err)) {
            logger.warn("[voice] realtime not open — cleared for reconnect", {
              component: "voice",
              handler: "session",
              step: "realtime_guard",
              result: "skipped",
              error_type: "openai",
              ...(deviceId ? { device_id: deviceId } : {}),
            });
            await dropDeadRealtime();
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          const errorType = classifyError(err);
          sessionResult = "error";
          recordVoiceError({ errorType, handler: "session" });
          logger.exception("[voice-gateway]", err, {
            component: "voice",
            handler: "session",
            result: "error",
            error_type: errorType,
            ...(deviceId ? { device_id: deviceId } : {}),
          });
          send({ type: "error", message });
        }
      })();
    });

    socket.on("close", () => {
      const { wasVoiceOwner } = this.deps.deviceRegistry.unregister(socket);
      void wasVoiceOwner;
      audioEgress?.clear();
      void realtime?.close();
      realtime = null;
      realtimeReadyAnnounced = false;
      finishSessionMetrics("socket_close");
    });
  }
}
