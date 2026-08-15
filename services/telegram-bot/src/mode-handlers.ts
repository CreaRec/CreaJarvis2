import type { Context } from "telegraf";
import { logger } from "./log.js";
import type { ReplyMode, UsersStore } from "./users-store.js";
import {
  formatModeHelp,
  getCommandArgument,
  replyWithMainKeyboard,
} from "./telegram-ctx.js";

export class ModeHandlers {
  constructor(private readonly users: UsersStore) {}

  async handleStart(ctx: Context, userId: number): Promise<void> {
    const mode = await this.users.getReplyMode(userId);
    logger.info("[telegram] /start", {
      component: "telegram",
      handler: "start",
      step: "reply",
    });
    await replyWithMainKeyboard(ctx, formatModeHelp(mode));
  }

  async handleMode(ctx: Context, userId: number): Promise<void> {
    const arg = getCommandArgument(ctx)?.toLowerCase();
    if (!arg) {
      const mode = await this.users.getReplyMode(userId);
      await replyWithMainKeyboard(
        ctx,
        `Режим ответа: ${mode}.\nИспользуй /mode text или /mode voice.`,
      );
      return;
    }
    if (arg !== "text" && arg !== "voice") {
      await replyWithMainKeyboard(
        ctx,
        "Неизвестный режим. Используй /mode text или /mode voice.",
      );
      return;
    }
    const mode = await this.users.setReplyMode(userId, arg as ReplyMode);
    logger.info("[telegram] mode changed", {
      component: "telegram",
      handler: "mode",
      step: "update",
      result: "success",
      reply_mode: mode,
    });
    await replyWithMainKeyboard(
      ctx,
      `Ок, буду отвечать ${mode === "voice" ? "голосом" : "текстом"}.`,
    );
  }
}
