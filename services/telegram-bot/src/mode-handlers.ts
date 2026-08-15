import type { Context } from "telegraf";
import { logger } from "./log.js";
import type { ReplyMode, UsersStoreLike } from "./users-store.js";
import {
  formatModeHelp,
  getCommandArgument,
  otherReplyMode,
  replyWithMainKeyboard,
} from "./telegram-ctx.js";

export class ModeHandlers {
  constructor(private readonly users: UsersStoreLike) {}

  async handleStart(ctx: Context, userId: number): Promise<void> {
    const mode = await this.users.getReplyMode(userId);
    logger.info("[telegram] /start", {
      component: "telegram",
      handler: "start",
      step: "reply",
    });
    await replyWithMainKeyboard(ctx, formatModeHelp(mode), mode);
  }

  async handleModeButton(
    ctx: Context,
    userId: number,
    shown: ReplyMode,
  ): Promise<void> {
    await this.applyMode(ctx, userId, otherReplyMode(shown));
  }

  async handleMode(ctx: Context, userId: number): Promise<void> {
    const arg = getCommandArgument(ctx)?.toLowerCase();
    if (!arg) {
      const mode = await this.users.getReplyMode(userId);
      await replyWithMainKeyboard(
        ctx,
        `Режим ответа: ${mode}. Нажми кнопку, чтобы переключить.`,
        mode,
      );
      return;
    }
    if (arg !== "text" && arg !== "voice") {
      const mode = await this.users.getReplyMode(userId);
      await replyWithMainKeyboard(
        ctx,
        "Неизвестный режим. Используй /mode text или /mode voice.",
        mode,
      );
      return;
    }
    await this.applyMode(ctx, userId, arg);
  }

  private async applyMode(
    ctx: Context,
    userId: number,
    next: ReplyMode,
  ): Promise<void> {
    const mode = await this.users.setReplyMode(userId, next);
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
      mode,
    );
  }
}
