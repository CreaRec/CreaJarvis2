import type { Context } from "telegraf";
import type { BotConfig } from "./config.js";
import { looksLikeOgg, toTelegramVoiceOgg } from "./ffmpeg.js";
import {
  jarvisAgentTurn,
  jarvisClearSession,
  jarvisInboxAdd,
} from "./jarvis-client.js";
import { logger, truncateForLog } from "./log.js";
import { MediaGroupBuffer } from "./media-group-buffer.js";
import { synthesizeSpeech, transcribeAudio } from "./openai-audio.js";
import { mainKeyboard, replyWithMainKeyboard } from "./telegram-ctx.js";
import { classifyError } from "./telemetry.js";
import type { ReplyMode, UsersStoreLike } from "./users-store.js";

export interface ChatHandlersDeps {
  config: BotConfig;
  users: UsersStoreLike;
  fetchImpl?: typeof fetch;
  toVoiceOgg?: (input: Buffer) => Promise<Buffer>;
  agentTurn?: typeof jarvisAgentTurn;
  clearSession?: typeof jarvisClearSession;
  inboxAdd?: typeof jarvisInboxAdd;
}

type PendingFile = {
  ctx: Context;
  userId: number;
  fileId: string;
  filename: string;
  mimeType: string;
  caption?: string;
};

export class ChatHandlers {
  private readonly mediaGroups: MediaGroupBuffer<PendingFile>;

  constructor(private readonly deps: ChatHandlersDeps) {
    this.mediaGroups = new MediaGroupBuffer(
      deps.config.MEDIA_GROUP_DEBOUNCE_MS,
      async (_key, items) => {
        const first = items[0];
        if (!first) return;
        let lastCount = 0;
        for (const item of items) {
          lastCount = await this.stageFile(item);
        }
        const caption = items.map((i) => i.caption?.trim()).find(Boolean);
        if (caption) {
          await this.runTurn(first.ctx, first.userId, caption);
        } else {
          await this.reply(
            first.ctx,
            first.userId,
            `Сохранил (${lastCount}). Напиши, что с этим сделать.`,
          );
        }
      },
    );
  }

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
      await this.reply(ctx, userId, "Контекст сброшен.");
    } catch (err) {
      logger.exception("[telegram] session clear failed", err, {
        component: "telegram",
        handler: "chat",
        step: "session_clear",
        result: "error",
        error_type: classifyError(err),
      });
      await this.reply(
        ctx,
        userId,
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
      await this.reply(ctx, userId, "Не удалось прочитать голосовое сообщение.");
      return;
    }
    const voice = message.voice;
    if (
      voice.file_size &&
      voice.file_size > this.deps.config.MAX_VOICE_BYTES
    ) {
      await this.reply(
        ctx,
        userId,
        "Голосовое слишком большое. Пришли покороче или текстом.",
      );
      return;
    }
    if (voice.duration > this.deps.config.MAX_VOICE_DURATION_SEC) {
      await this.reply(
        ctx,
        userId,
        "Голосовое слишком длинное. Пришли покороче или текстом.",
      );
      return;
    }

    try {
      await ctx.replyWithChatAction("typing").catch(() => undefined);
      const fileLink = await ctx.telegram.getFileLink(voice.file_id);
      const audio = await this.downloadFile(fileLink.href);
      if (audio.length > this.deps.config.MAX_VOICE_BYTES) {
        await this.reply(
          ctx,
          userId,
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
      await this.reply(
        ctx,
        userId,
        "Не смог разобрать голосовое. Попробуй ещё раз или напиши текстом.",
      );
    }
  }

  async handlePhoto(ctx: Context, userId: number): Promise<void> {
    const message = ctx.message;
    if (!message || !("photo" in message) || !message.photo?.length) {
      await this.reply(ctx, userId, "Не удалось прочитать фото.");
      return;
    }
    const largest = message.photo[message.photo.length - 1]!;
    if (
      largest.file_size &&
      largest.file_size > this.deps.config.MAX_ATTACHMENT_BYTES
    ) {
      await this.reply(ctx, userId, "Файл слишком большой. Пришли поменьше.");
      return;
    }
    const caption =
      "caption" in message && typeof message.caption === "string"
        ? message.caption
        : undefined;
    const pending: PendingFile = {
      ctx,
      userId,
      fileId: largest.file_id,
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      caption,
    };
    const groupId =
      "media_group_id" in message && message.media_group_id
        ? String(message.media_group_id)
        : undefined;
    if (groupId) {
      this.mediaGroups.push(`${userId}:${groupId}`, pending);
      return;
    }
    await this.stageAndMaybeFlush(pending);
  }

  async handleDocument(ctx: Context, userId: number): Promise<void> {
    const message = ctx.message;
    if (!message || !("document" in message) || !message.document) {
      await this.reply(ctx, userId, "Не удалось прочитать файл.");
      return;
    }
    const doc = message.document;
    if (
      doc.file_size &&
      doc.file_size > this.deps.config.MAX_ATTACHMENT_BYTES
    ) {
      await this.reply(ctx, userId, "Файл слишком большой. Пришли поменьше.");
      return;
    }
    const mime = doc.mime_type?.trim() || "application/octet-stream";
    const caption =
      "caption" in message && typeof message.caption === "string"
        ? message.caption
        : undefined;
    const pending: PendingFile = {
      ctx,
      userId,
      fileId: doc.file_id,
      filename: doc.file_name?.trim() || "document.bin",
      mimeType: mime,
      caption,
    };
    const groupId =
      "media_group_id" in message && message.media_group_id
        ? String(message.media_group_id)
        : undefined;
    if (groupId) {
      this.mediaGroups.push(`${userId}:${groupId}`, pending);
      return;
    }
    await this.stageAndMaybeFlush(pending);
  }

  private async stageAndMaybeFlush(pending: PendingFile): Promise<void> {
    try {
      const count = await this.stageFile(pending);
      if (pending.caption?.trim()) {
        await this.runTurn(pending.ctx, pending.userId, pending.caption.trim());
        return;
      }
      await this.reply(
        pending.ctx,
        pending.userId,
        `Сохранил (${count}). Напиши, что с этим сделать.`,
      );
    } catch (err) {
      logger.exception("[telegram] inbox stage failed", err, {
        component: "telegram",
        handler: "chat",
        step: "inbox_add",
        result: "error",
        error_type: classifyError(err),
      });
      await this.reply(
        pending.ctx,
        pending.userId,
        "Не удалось сохранить файл. Попробуй ещё раз.",
      );
    }
  }

  private async stageFile(pending: PendingFile): Promise<number> {
    const fileLink = await pending.ctx.telegram.getFileLink(pending.fileId);
    const bytes = await this.downloadFile(fileLink.href);
    if (bytes.length > this.deps.config.MAX_ATTACHMENT_BYTES) {
      throw new Error("File too large after download");
    }
    const add = this.deps.inboxAdd ?? jarvisInboxAdd;
    const status = await add({
      baseUrl: this.deps.config.JARVIS_BASE_URL,
      token: this.deps.config.JARVIS_GATEWAY_TOKEN,
      userId: String(pending.userId),
      filename: pending.filename,
      mimeType: pending.mimeType,
      bytes,
      fetchImpl: this.deps.fetchImpl,
    });
    logger.info("[telegram] inbox staged", {
      component: "telegram",
      handler: "chat",
      step: "inbox_add",
      result: "success",
      attachment_count: status.count,
    });
    return status.count;
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
      await this.reply(
        ctx,
        userId,
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
      await replyWithMainKeyboard(ctx, text, mode);
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
      await ctx.replyWithVoice(
        { source: audio, filename: "jarvis.ogg" },
        mainKeyboard(mode),
      );
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
      await replyWithMainKeyboard(ctx, text, mode);
    }
  }

  private async reply(
    ctx: Pick<Context, "reply">,
    userId: number,
    message: string,
  ): Promise<void> {
    const mode = await this.deps.users.getReplyMode(userId);
    await replyWithMainKeyboard(ctx, message, mode);
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
