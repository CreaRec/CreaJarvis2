import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { AppConfig } from "../config.js";
import { RealtimeClient } from "../realtime/client.js";
import type { ToolGateway } from "../tools/gateway.js";

export type ClientOutbound =
  | { type: "ready" }
  | { type: "audio.delta"; audio: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "response.done" }
  | { type: "tool.status"; tool: string; ok: boolean }
  | { type: "error"; message: string };

type ClientInbound =
  | { type: "session.start" }
  | { type: "audio.append"; audio: string }
  | { type: "audio.commit" }
  | { type: "session.end" }
  | { type: "text"; text: string };

export interface VoiceGatewayDeps {
  config: AppConfig;
  tools: ToolGateway;
  getInstructions: () => Promise<string>;
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

  private async handleConnection(
    socket: WebSocket,
    _req: IncomingMessage,
  ): Promise<void> {
    let realtime: RealtimeClient | null = null;

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
          // Only signal completion for a final model turn (not a tool-call turn).
          if (!hasFunctionCall) {
            send({ type: "response.done" });
          }
        },
      });
      await realtime.connect();
      send({ type: "ready" });
      return realtime;
    };

    socket.on("message", (data) => {
      void (async () => {
        try {
          const msg = JSON.parse(data.toString()) as ClientInbound;
          switch (msg.type) {
            case "session.start":
              await ensureRealtime();
              break;
            case "audio.append": {
              const rt = await ensureRealtime();
              if (!msg.audio) {
                send({ type: "error", message: "audio.append missing audio" });
                break;
              }
              rt.appendAudio(msg.audio);
              break;
            }
            case "audio.commit": {
              const rt = await ensureRealtime();
              rt.commitAudio();
              break;
            }
            case "text": {
              const rt = await ensureRealtime();
              await rt.sendText(msg.text);
              break;
            }
            case "session.end":
              await realtime?.close();
              realtime = null;
              break;
            default:
              send({ type: "error", message: `Unknown message type` });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[voice-gateway]", message);
          send({ type: "error", message });
        }
      })();
    });

    socket.on("close", () => {
      void realtime?.close();
    });
  }
}
