import type { Context } from "telegraf";
import { runAgentTurn } from "../agent/turn.js";
import type { TelegramConfig } from "../config.js";
import { logger, truncateForLog } from "../log.js";
import { synthesizeSpeech } from "../openai/speech.js";
import { transcribeAudio } from "../openai/transcribe.js";
import type { ToolGateway } from "../tools/gateway.js";
import {
  classifyError,
  recordHandledSession,
  recordVoiceError,
  withVoiceSessionSpan,
} from "../telemetry.js";
import { looksLikeOgg, toTelegramVoiceOgg } from "./ffmpeg.js";
import type { ReplyMode, TelegramSettingsStoreApi } from "./settings-store.js";
import { safeReply } from "./telegram-ctx.js";

export interface ChatHandlersDeps {
  telegram: Extract<TelegramConfig, { enabled: true }>;
  openaiApiKey: string;
  tools: ToolGateway;
  settings: TelegramSettingsStoreApi;
  getInstructions: () => Promise<string>;
  fetchImpl?: typeof fetch;
  toVoiceOgg?: (input: Buffer) => Promise<Buffer>;
}

export class ChatHandlers {
  constructor(private readonly deps: ChatHandlersDeps) {}

  async handleText(ctx: Context, userId: number, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await this.runTurn(ctx, userId, trimmed, "text");
  }

  async handleVoice(ctx: Context, userId: number): Promise<void> {
    const message = ctx.message;
    if (!message || !("voice" in message) || !message.voice) {
      await safeReply(
        (t) => ctx.reply(t),
        "Не удалось прочитать голосовое сообщение.",
      );
      return;
    }

    const voice = message.voice;
    if (voice.file_size && voice.file_size > this.deps.telegram.maxVoiceBytes) {
      await safeReply(
        (t) => ctx.reply(t),
        "Голосовое слишком большое. Пришли покороче или текстом.",
      );
      return;
    }
    if (voice.duration > this.deps.telegram.maxVoiceDurationSec) {
      await safeReply(
        (t) => ctx.reply(t),
        "Голосовое слишком длинное. Пришли покороче или текстом.",
      );
      return;
    }

    const started = Date.now();
    try {
      await ctx.replyWithChatAction("typing").catch(() => undefined);
      const fileLink = await ctx.telegram.getFileLink(voice.file_id);
      const audio = await this.downloadFile(fileLink.href);
      if (audio.length > this.deps.telegram.maxVoiceBytes) {
        await safeReply(
          (t) => ctx.reply(t),
          "Голосовое слишком большое. Пришли покороче или текстом.",
        );
        return;
      }

      const userText = await transcribeAudio({
        apiKey: this.deps.openaiApiKey,
        audio,
        filename: "voice.ogg",
        model: this.deps.telegram.sttModel,
        language: "ru",
        fetchImpl: this.deps.fetchImpl,
      });

      logger.info("[telegram] voice transcribed", {
        component: "telegram",
        handler: "telegram",
        step: "stt",
        result: "success",
        duration_ms: Date.now() - started,
        user_text: truncateForLog(userText),
      });

      await this.runTurn(ctx, userId, userText, "voice");
    } catch (err) {
      const errorType = classifyError(err);
      recordVoiceError({ errorType, handler: "telegram" });
      logger.exception("[telegram] voice handling failed", err, {
        component: "telegram",
        handler: "telegram",
        step: "stt",
        result: "error",
        error_type: errorType,
      });
      await safeReply(
        (t) => ctx.reply(t),
        "Не смог разобрать голосовое. Попробуй ещё раз или напиши текстом.",
      );
    }
  }

  private async runTurn(
    ctx: Context,
    userId: number,
    userText: string,
    inputKind: "text" | "voice",
  ): Promise<void> {
    const started = Date.now();
    let result: "success" | "error" = "success";

    await withVoiceSessionSpan(
      "voice.session",
      { handler: "telegram", input_kind: inputKind },
      async () => {
        try {
          await ctx.replyWithChatAction("typing").catch(() => undefined);
          const mode = await this.deps.settings.getReplyMode(userId);
          const instructions = await this.deps.getInstructions();
          const turn = await runAgentTurn({
            apiKey: this.deps.openaiApiKey,
            model: this.deps.telegram.chatModel,
            instructions,
            userText,
            tools: this.deps.tools,
            fetchImpl: this.deps.fetchImpl,
          });

          logger.info("[telegram] turn done", {
            component: "telegram",
            handler: "telegram",
            step: "turn",
            result: "success",
            duration_ms: Date.now() - started,
            reply_mode: mode,
            user_text: truncateForLog(userText),
            iterations: turn.iterations,
          });

          await this.deliverReply(ctx, turn.text, mode);
        } catch (err) {
          result = "error";
          const errorType = classifyError(err);
          recordVoiceError({ errorType, handler: "telegram" });
          logger.exception("[telegram] turn failed", err, {
            component: "telegram",
            handler: "telegram",
            step: "turn",
            result: "error",
            error_type: errorType,
            user_text: truncateForLog(userText),
          });
          await safeReply(
            (t) => ctx.reply(t),
            "Что-то сломалось на моей стороне. Попробуй ещё раз.",
          );
          throw err;
        } finally {
          recordHandledSession({
            result,
            durationSeconds: (Date.now() - started) / 1000,
            handler: "telegram",
          });
        }
      },
    ).catch(() => {
      // error already logged and replied
    });
  }

  private async deliverReply(
    ctx: Context,
    text: string,
    mode: ReplyMode,
  ): Promise<void> {
    if (mode === "text") {
      await safeReply((t) => ctx.reply(t), text);
      return;
    }

    try {
      await ctx.replyWithChatAction("record_voice").catch(() => undefined);
      let audio = await synthesizeSpeech({
        apiKey: this.deps.openaiApiKey,
        text,
        voice: this.deps.telegram.ttsVoice,
        model: this.deps.telegram.ttsModel,
        responseFormat: "opus",
        fetchImpl: this.deps.fetchImpl,
      });

      if (!looksLikeOgg(audio)) {
        const convert = this.deps.toVoiceOgg ?? ((buf) => toTelegramVoiceOgg(buf));
        audio = await convert(audio);
      }

      await ctx.replyWithVoice({
        source: audio,
        filename: "jarvis.ogg",
      });
    } catch (err) {
      logger.exception("[telegram] TTS/sendVoice failed; falling back to text", err, {
        component: "telegram",
        handler: "telegram",
        step: "tts",
        result: "error",
        error_type: classifyError(err),
      });
      await safeReply((t) => ctx.reply(t), text);
    }
  }

  private async downloadFile(url: string): Promise<Buffer> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Telegram file download failed (${response.status})`);
    }
    const ab = await response.arrayBuffer();
    return Buffer.from(ab);
  }
}
