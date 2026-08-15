import type { Context } from "telegraf";
import { logger } from "../log.js";
import type { ReplyMode, TelegramSettingsStoreApi } from "./settings-store.js";
import {
  formatModeHelp,
  getCommandArgument,
  safeReply,
} from "./telegram-ctx.js";

export class ModeHandlers {
  constructor(private readonly settings: TelegramSettingsStoreApi) {}

  async handleStart(ctx: Context, userId: number): Promise<void> {
    const mode = await this.settings.getReplyMode(userId);
    logger.info("[telegram] /start", {
      component: "telegram",
      handler: "telegram",
      step: "start",
    });
    await safeReply((text) => ctx.reply(text), formatModeHelp(mode));
  }

  async handleMode(ctx: Context, userId: number): Promise<void> {
    const arg = getCommandArgument(ctx)?.toLowerCase();
    if (!arg) {
      const mode = await this.settings.getReplyMode(userId);
      await safeReply(
        (text) => ctx.reply(text),
        `Режим ответа: ${mode}.\nИспользуй /mode text или /mode voice.`,
      );
      return;
    }
    if (arg !== "text" && arg !== "voice") {
      await safeReply(
        (text) => ctx.reply(text),
        "Неизвестный режим. Используй /mode text или /mode voice.",
      );
      return;
    }
    const mode = await this.settings.setReplyMode(userId, arg as ReplyMode);
    logger.info("[telegram] mode changed", {
      component: "telegram",
      handler: "telegram",
      step: "mode",
      result: "success",
      reply_mode: mode,
    });
    await safeReply(
      (text) => ctx.reply(text),
      `Ок, буду отвечать ${mode === "voice" ? "голосом" : "текстом"}.`,
    );
  }
}
