import { Telegraf } from "telegraf";
import type { BotConfig } from "./config.js";
import { ChatHandlers } from "./chat-handlers.js";
import { logger } from "./log.js";
import { ModeHandlers } from "./mode-handlers.js";
import {
  BOT_HELP_MESSAGE,
  BOT_PRIVATE_MESSAGE,
  isPrivateChat,
  matchKeyboardAction,
  replyWithMainKeyboard,
  safeReply,
} from "./telegram-ctx.js";
import { classifyError } from "./telemetry.js";
import type { UsersStore } from "./users-store.js";

export class TelegramBotService {
  private readonly bot: Telegraf;
  private readonly modeHandlers: ModeHandlers;
  private readonly chatHandlers: ChatHandlers;
  private running = false;

  constructor(
    private readonly config: BotConfig,
    private readonly users: UsersStore,
  ) {
    this.bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
    this.modeHandlers = new ModeHandlers(users);
    this.chatHandlers = new ChatHandlers({ config, users });
    this.registerHandlers();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    void this.bot.launch().catch((err) => {
      this.running = false;
      logger.exception("[telegram] bot.launch failed", err, {
        component: "telegram",
        handler: "bot",
        step: "start",
        result: "error",
        error_type: classifyError(err),
      });
    });
    logger.info("[telegram] bot started", {
      component: "telegram",
      handler: "bot",
      step: "start",
    });
  }

  async stop(reason = "shutdown"): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.bot.stop(reason);
    logger.info("[telegram] bot stopped", {
      component: "telegram",
      handler: "bot",
      step: "stop",
      reason,
    });
  }

  private registerHandlers(): void {
    this.bot.use(async (ctx, next) => {
      if (!isPrivateChat(ctx)) return;
      const userId = ctx.from?.id;
      if (userId == null || !(await this.users.isAllowed(userId))) {
        logger.info("[telegram] unauthorized user rejected", {
          component: "telegram",
          handler: "auth",
          step: "auth_reject",
          result: "skipped",
        });
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery(BOT_PRIVATE_MESSAGE).catch(() => undefined);
        } else if (ctx.chat) {
          await safeReply((t) => ctx.reply(t), BOT_PRIVATE_MESSAGE);
        }
        return;
      }
      return next();
    });

    this.bot.start(async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      await this.modeHandlers.handleStart(ctx, userId);
    });

    this.bot.command("mode", async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      await this.modeHandlers.handleMode(ctx, userId);
    });

    this.bot.command("new", async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      await this.chatHandlers.handleNew(ctx, userId);
    });

    this.bot.on("text", async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      const text = ctx.message.text;
      if (text.startsWith("/")) return;
      const action = matchKeyboardAction(text);
      if (action === "mode") {
        await this.modeHandlers.handleMode(ctx, userId);
        return;
      }
      if (action === "new") {
        await this.chatHandlers.handleNew(ctx, userId);
        return;
      }
      await this.chatHandlers.handleText(ctx, userId, text);
    });

    this.bot.on("voice", async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      await this.chatHandlers.handleVoice(ctx, userId);
    });

    this.bot.on("photo", async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      await this.chatHandlers.handlePhoto(ctx, userId);
    });

    this.bot.on("document", async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      await this.chatHandlers.handleDocument(ctx, userId);
    });

    this.bot.on("message", async (ctx) => {
      if (!isPrivateChat(ctx)) return;
      const msg = ctx.message ?? {};
      if (
        "text" in msg ||
        "voice" in msg ||
        "photo" in msg ||
        "document" in msg
      ) {
        return;
      }
      await replyWithMainKeyboard(ctx, BOT_HELP_MESSAGE);
    });

    this.bot.catch((err, ctx) => {
      logger.exception("[telegram] unhandled bot error", err, {
        component: "telegram",
        handler: "bot",
        step: "catch",
        result: "error",
        error_type: classifyError(err),
        update_type: ctx.updateType,
      });
    });
  }
}
