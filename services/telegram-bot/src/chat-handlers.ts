import type { Context } from "telegraf";
import type { BotConfig } from "./config.js";
import { looksLikeOgg, toTelegramVoiceOgg } from "./ffmpeg.js";
import { jarvisAgentTurn, jarvisClearSession } from "./jarvis-client.js";
import { logger, truncateForLog } from "./log.js";
import { synthesizeSpeech, transcribeAudio } from "./openai-audio.js";
import { safeReply } from "./telegram-ctx.js";
import { classifyError } from "./telemetry.js";
import type { ReplyMode, UsersStore } from "./users-store.js";

export interface ChatHandlersDeps {
  config: BotConfig;
  users: UsersStore;
  fetchImpl?: typeof fetch;
  toVoiceOgg?: (input: Buffer) => Promise<Buffer>;
  agentTurn?: typeof jarvisAgentTurn;
  clearSession?: typeof jarvisClearSession;
}

export class ChatHandlers {
  constructor(private readonly deps: ChatHandlersDeps) {}

  async handleNew(ctx: Context, userId: number): Promise<void> {
    try {
      const clear = this.deps.clearSession ?? jarvisClearSession;
      await clear({
        baseUrl: this.deps.config.JARVIS_BASE_URL,
        token: this.deps.config.JARVIS_GATEWAY_TOKEN,
        userId: String(userId),
        fetchImpl: this.deps.fetchImpl,
      });
      logger.info("[telegram] session cleared", {
        component: "telegram",
        handler: "chat",
        step: "session_clear",
        result: "success",
      });
      await safeReply((t) => ctx.reply(t), "Контекст сброшен.");
    } catch (err) {
      logger.exception("[telegram] session clear failed", err, {
        component: "telegram",
        handler: "chat",
        step: "session_clear",
        result: "error",
        error_type: classifyError(err),
      });
      await safeReply(
        (t) => ctx.reply(t),
        "Не удалось сбросить контекст. Попробуй ещё раз.",
      );
    }
  }

  async handleText(ctx: Context, userId: number, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    await this.runTurn(ctx, userId, trimmed);
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
    if (
      voice.file_size &&
      voice.file_size > this.deps.config.MAX_VOICE_BYTES
    ) {
      await safeReply(
        (t) => ctx.reply(t),
        "Голосовое слишком большое. Пришли покороче или текстом.",
      );
      return;
    }
    if (voice.duration > this.deps.config.MAX_VOICE_DURATION_SEC) {
      await safeReply(
        (t) => ctx.reply(t),
        "Голосовое слишком длинное. Пришли покороче или текстом.",
      );
      return;
    }

    try {
      await ctx.replyWithChatAction("typing").catch(() => undefined);
      const fileLink = await ctx.telegram.getFileLink(voice.file_id);
      const audio = await this.downloadFile(fileLink.href);
      if (audio.length > this.deps.config.MAX_VOICE_BYTES) {
        await safeReply(
          (t) => ctx.reply(t),
          "Голосовое слишком большое. Пришли покороче или текстом.",
        );
        return;
      }
      const userText = await transcribeAudio({
        apiKey: this.deps.config.OPENAI_API_KEY,
        audio,
        filename: "voice.ogg",
        model: this.deps.config.STT_MODEL,
        language: "ru",
        fetchImpl: this.deps.fetchImpl,
      });
      logger.info("[telegram] voice transcribed", {
        component: "telegram",
        handler: "voice",
        step: "stt",
        result: "success",
        user_text: truncateForLog(userText),
      });
      await this.runTurn(ctx, userId, userText);
    } catch (err) {
      logger.exception("[telegram] voice handling failed", err, {
        component: "telegram",
        handler: "voice",
        step: "stt",
        result: "error",
        error_type: classifyError(err),
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
  ): Promise<void> {
    const started = Date.now();
    try {
      await ctx.replyWithChatAction("typing").catch(() => undefined);
      const mode = await this.deps.users.getReplyMode(userId);
      const turn = this.deps.agentTurn ?? jarvisAgentTurn;
      const replyText = await turn({
        baseUrl: this.deps.config.JARVIS_BASE_URL,
        token: this.deps.config.JARVIS_GATEWAY_TOKEN,
        text: userText,
        userId: String(userId),
        fetchImpl: this.deps.fetchImpl,
      });
      logger.info("[telegram] turn done", {
        component: "telegram",
        handler: "chat",
        step: "turn",
        result: "success",
        duration_ms: Date.now() - started,
        reply_mode: mode,
        user_text: truncateForLog(userText),
      });
      await this.deliverReply(ctx, replyText, mode);
    } catch (err) {
      logger.exception("[telegram] turn failed", err, {
        component: "telegram",
        handler: "chat",
        step: "turn",
        result: "error",
        error_type: classifyError(err),
        user_text: truncateForLog(userText),
      });
      await safeReply(
        (t) => ctx.reply(t),
        "Что-то сломалось на моей стороне. Попробуй ещё раз.",
      );
    }
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
        apiKey: this.deps.config.OPENAI_API_KEY,
        text,
        voice: this.deps.config.TTS_VOICE,
        model: this.deps.config.TTS_MODEL,
        responseFormat: "opus",
        fetchImpl: this.deps.fetchImpl,
      });
      if (!looksLikeOgg(audio)) {
        const convert =
          this.deps.toVoiceOgg ?? ((buf) => toTelegramVoiceOgg(buf));
        audio = await convert(audio);
      }
      await ctx.replyWithVoice({ source: audio, filename: "jarvis.ogg" });
    } catch (err) {
      logger.exception(
        "[telegram] TTS/sendVoice failed; falling back to text",
        err,
        {
          component: "telegram",
          handler: "chat",
          step: "tts",
          result: "error",
          error_type: classifyError(err),
        },
      );
      await safeReply((t) => ctx.reply(t), text);
    }
  }

  private async downloadFile(url: string): Promise<Buffer> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Telegram file download failed (${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
