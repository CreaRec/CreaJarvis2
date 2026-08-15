import { Telegraf } from "telegraf";
import type { TelegramConfig } from "../config.js";
import { logger } from "../log.js";
import { classifyError } from "../telemetry.js";
import type { ToolGateway } from "../tools/gateway.js";
import { ChatHandlers } from "./chat-handlers.js";
import { ModeHandlers } from "./mode-handlers.js";
import type { TelegramSettingsStoreApi } from "./settings-store.js";
import {
  BOT_HELP_MESSAGE,
  BOT_PRIVATE_MESSAGE,
  isPrivateChat,
  safeReply,
} from "./telegram-ctx.js";

export interface TelegramBotDeps {
  telegram: Extract<TelegramConfig, { enabled: true }>;
  openaiApiKey: string;
  tools: ToolGateway;
  settings: TelegramSettingsStoreApi;
  getInstructions: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

export class TelegramBotService {
  private readonly bot: Telegraf;
  private readonly modeHandlers: ModeHandlers;
  private readonly chatHandlers: ChatHandlers;
  private running = false;

  constructor(private readonly deps: TelegramBotDeps) {
    this.bot = new Telegraf(deps.telegram.botToken);
    this.modeHandlers = new ModeHandlers(deps.settings);
    this.chatHandlers = new ChatHandlers({
      telegram: deps.telegram,
      openaiApiKey: deps.openaiApiKey,
      tools: deps.tools,
      settings: deps.settings,
      getInstructions: deps.getInstructions,
      fetchImpl: deps.fetchImpl,
    });
    this.registerHandlers();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Don't await forever — launch resolves after polling starts in telegraf 4.
    void this.bot.launch().catch((err) => {
      this.running = false;
      logger.exception("[telegram] bot.launch failed", err, {
        component: "telegram",
        handler: "telegram",
        step: "start",
        result: "error",
        error_type: classifyError(err),
      });
    });
    logger.info("[telegram] bot started", {
      component: "telegram",
      handler: "telegram",
      step: "start",
    });
  }

  async stop(reason = "shutdown"): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.bot.stop(reason);
    logger.info("[telegram] bot stopped", {
      component: "telegram",
      handler: "telegram",
      step: "stop",
      reason,
    });
  }

  private registerHandlers(): void {
    this.bot.use(async (ctx, next) => {
      if (!isPrivateChat(ctx)) {
        return;
      }
      const userId = ctx.from?.id;
      if (userId == null || !(await this.deps.settings.isAllowed(userId))) {
        logger.info("[telegram] unauthorized user rejected", {
          component: "telegram",
          handler: "telegram",
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

    this.bot.on("text", async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      const text = ctx.message.text;
      if (text.startsWith("/")) return;
      await this.chatHandlers.handleText(ctx, userId, text);
    });

    this.bot.on("voice", async (ctx) => {
      const userId = ctx.from?.id;
      if (userId == null) return;
      await this.chatHandlers.handleVoice(ctx, userId);
    });

    this.bot.on("message", async (ctx) => {
      // Catch-all for private allowed users with unsupported content.
      if (!isPrivateChat(ctx)) return;
      if ("text" in (ctx.message ?? {}) || "voice" in (ctx.message ?? {})) {
        return;
      }
      await safeReply((t) => ctx.reply(t), BOT_HELP_MESSAGE);
    });

    this.bot.catch((err, ctx) => {
      logger.exception("[telegram] unhandled bot error", err, {
        component: "telegram",
        handler: "telegram",
        step: "catch",
        result: "error",
        error_type: classifyError(err),
        update_type: ctx.updateType,
      });
    });
  }
}
