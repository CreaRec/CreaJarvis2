import WebSocket from "ws";
import type { AppConfig } from "../config.js";
import { logger } from "../log.js";
import { classifyError, recordVoiceError } from "../telemetry.js";
import { parseJsonArgs, type ToolGateway } from "../tools/gateway.js";

export type RealtimeEventHandler = (event: Record<string, unknown>) => void;

export interface RealtimeClientOptions {
  config: AppConfig;
  instructions: string;
  tools: ToolGateway;
  onEvent?: RealtimeEventHandler;
  onAudioDelta?: (base64Pcm: string) => void;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private readonly pendingArgs = new Map<string, { name: string; args: string }>();
  private readonly handledCalls = new Set<string>();
  private closing = false;

  constructor(private readonly opts: RealtimeClientOptions) {}

  async connect(): Promise<void> {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.opts.config.REALTIME_MODEL)}`;
    // GA Realtime: do NOT send OpenAI-Beta: realtime=v1 (beta shape is disabled).
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.opts.config.OPENAI_API_KEY}`,
      },
    });

    await new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      const onError = (err: Error) => reject(err);
      ws.once("open", () => {
        ws.off("error", onError);
        resolve();
      });
      ws.once("error", onError);
    });

    const sessionReady = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for session.updated from Realtime"));
      }, 15_000);

      const onMessage = (data: WebSocket.RawData) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(event.type ?? "");
        if (type === "session.updated") {
          clearTimeout(timeout);
          this.ws?.off("message", onMessage);
          resolve();
        } else if (type === "error") {
          clearTimeout(timeout);
          this.ws?.off("message", onMessage);
          reject(
            new Error(
              `Realtime session error: ${JSON.stringify((event as { error?: unknown }).error ?? event)}`,
            ),
          );
        }
      };

      this.ws!.on("message", onMessage);
    });

    this.ws.on("message", (data) => {
      void this.handleMessage(data.toString());
    });
    this.ws.on("close", (code, reason) => {
      if (!this.closing) {
        logger.warn("[realtime] connection closed", {
          component: "realtime",
          handler: "realtime",
          step: "close",
          code,
          reason: reason.toString(),
        });
      }
    });

    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        model: this.opts.config.REALTIME_MODEL,
        output_modalities: ["audio"],
        instructions: this.opts.instructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            // PTT: manual commit, no server VAD
            turn_detection: null,
            transcription: { model: "gpt-4o-mini-transcribe" },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: this.opts.config.VOICE,
          },
        },
        tools: this.opts.tools.listRealtimeTools(),
        tool_choice: "auto",
      },
    });

    await sessionReady;
  }

  async updateInstructions(instructions: string): Promise<void> {
    this.send({
      type: "session.update",
      session: { type: "realtime", instructions },
    });
  }

  appendAudio(base64Pcm: string): void {
    this.send({
      type: "input_audio_buffer.append",
      audio: base64Pcm,
    });
  }

  commitAudio(): void {
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
  }

  async sendText(text: string): Promise<void> {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({
      type: "response.create",
      response: {
        // smoke/text turns: ask for both so we get transcripts + audio
        output_modalities: ["audio"],
      },
    });
  }

  /** Short spoken acknowledgment for wake UX ("Я тут"). */
  async playAck(prompt: string): Promise<void> {
    await this.sendText(prompt);
  }

  async close(): Promise<void> {
    this.closing = true;
    if (!this.ws) return;
    await new Promise<void>((resolve) => {
      this.ws!.once("close", () => resolve());
      this.ws!.close();
    });
    this.ws = null;
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime WebSocket is not open");
    }
    this.ws.send(JSON.stringify(payload));
  }

  private async handleMessage(raw: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    this.opts.onEvent?.(event);
    const type = String(event.type ?? "");

    // GA: response.output_audio.delta; keep legacy name as fallback
    if (
      (type === "response.output_audio.delta" || type === "response.audio.delta") &&
      typeof event.delta === "string"
    ) {
      this.opts.onAudioDelta?.(event.delta);
    }

    if (
      (type === "conversation.item.input_audio_transcription.completed" ||
        type === "conversation.item.input_audio_transcription.done") &&
      typeof event.transcript === "string"
    ) {
      this.opts.onTranscript?.("user", event.transcript);
    }

    if (
      (type === "response.output_audio_transcript.done" ||
        type === "response.audio_transcript.done") &&
      typeof event.transcript === "string"
    ) {
      this.opts.onTranscript?.("assistant", event.transcript);
    }

    // Text-only responses (if ever requested)
    if (type === "response.output_text.done" && typeof event.text === "string") {
      this.opts.onTranscript?.("assistant", event.text);
    }

    if (type === "response.output_item.added") {
      const item = event.item as
        | { type?: string; call_id?: string; name?: string }
        | undefined;
      if (item?.type === "function_call" && item.call_id) {
        const prev = this.pendingArgs.get(item.call_id) ?? {
          name: "",
          args: "",
        };
        this.pendingArgs.set(item.call_id, {
          name: item.name || prev.name,
          args: prev.args,
        });
      }
    }

    if (type === "response.function_call_arguments.delta") {
      const callId = String(event.call_id ?? "");
      const name = String(event.name ?? this.pendingArgs.get(callId)?.name ?? "");
      const delta = String(event.delta ?? "");
      const prev = this.pendingArgs.get(callId) ?? { name, args: "" };
      this.pendingArgs.set(callId, {
        name: name || prev.name,
        args: prev.args + delta,
      });
    }

    if (type === "response.function_call_arguments.done") {
      const callId = String(event.call_id ?? "");
      const name = String(event.name ?? this.pendingArgs.get(callId)?.name ?? "");
      const argsStr = String(
        event.arguments ?? this.pendingArgs.get(callId)?.args ?? "{}",
      );
      this.pendingArgs.delete(callId);
      await this.runTool(callId, name, argsStr);
    }

    // Prefer response.function_call_arguments.done; response.done is a fallback
    // only when we never saw the dedicated done event (avoid double-fire races).
    if (type === "response.done") {
      const response = event.response as
        | {
            output?: Array<{
              type?: string;
              call_id?: string;
              name?: string;
              arguments?: string;
            }>;
          }
        | undefined;
      for (const item of response?.output ?? []) {
        if (
          item.type === "function_call" &&
          item.call_id &&
          item.arguments != null &&
          !this.handledCalls.has(item.call_id)
        ) {
          await this.runTool(item.call_id, item.name ?? "", item.arguments);
        }
      }
    }

    if (type === "error") {
      recordVoiceError({ errorType: "openai", handler: "realtime" });
      logger.error("[realtime] error event", {
        component: "realtime",
        handler: "realtime",
        result: "error",
        error_type: "openai",
        event_type: type,
      });
    }
  }

  private async runTool(
    callId: string,
    name: string,
    argsStr: string,
  ): Promise<void> {
    if (!callId || this.handledCalls.has(callId)) return;
    this.handledCalls.add(callId);
    const args = parseJsonArgs(argsStr);
    logger.info("[tools] call", {
      component: "realtime",
      handler: "tool",
      step: "start",
      tool: name,
    });
    try {
      const result = await this.opts.tools.execute(name, args);
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        logger.error("[tools] Realtime socket closed before returning tool result", {
          component: "realtime",
          handler: "tool",
          step: "finish",
          result: "error",
          tool: name,
          error_type: "network",
        });
        return;
      }
      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result),
        },
      });
      this.send({ type: "response.create" });
      logger.info("[tools] call finished", {
        component: "realtime",
        handler: "tool",
        step: "finish",
        result: "success",
        tool: name,
      });
    } catch (err) {
      const errorType = classifyError(err);
      recordVoiceError({ errorType, handler: "tool" });
      logger.exception(`[tools] ${name} failed`, err, {
        component: "realtime",
        handler: "tool",
        step: "finish",
        result: "error",
        tool: name,
        error_type: errorType,
      });
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        });
        this.send({ type: "response.create" });
      } catch (sendErr) {
        logger.exception("[tools] failed to send error result", sendErr, {
          component: "realtime",
          handler: "tool",
          tool: name,
          error_type: classifyError(sendErr),
        });
      }
    }
  }
}
