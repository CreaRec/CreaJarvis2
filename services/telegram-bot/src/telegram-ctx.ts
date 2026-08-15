import { Markup, type Context } from "telegraf";
import { logger } from "./log.js";

export type ReplyFn = (message: string) => Promise<{ message_id?: number }>;

export const BOT_PRIVATE_MESSAGE = "This bot is private.";

export const BTN_MODE = "mode";
export const BTN_NEW = "new";

export const MAIN_KEYBOARD = Markup.keyboard([[BTN_MODE, BTN_NEW]])
  .resize()
  .persistent();

export const BOT_HELP_MESSAGE =
  "Я Jarvis в Telegram. Пришли текст, голосовое или файлы/фото.\n" +
  "Файлы копятся, потом напиши что с ними сделать (или подпись к фото).\n" +
  "Кнопки: mode — режим ответа, new — сбросить контекст и непроанализированные файлы.\n" +
  "Команды:\n" +
  "/start — справка\n" +
  "/new — сбросить контекст диалога и inbox\n" +
  "/mode — показать режим ответа\n" +
  "/mode text — отвечать текстом\n" +
  "/mode voice — отвечать голосовым сообщением";

/** Maps reply-keyboard labels to bot actions (case-insensitive). */
export function matchKeyboardAction(
  text: string,
): "mode" | "new" | undefined {
  const normalized = text.trim().toLowerCase();
  if (normalized === BTN_MODE) return "mode";
  if (normalized === BTN_NEW) return "new";
  return undefined;
}

export function isPrivateChat(ctx: Context): boolean {
  return !!ctx.chat && ctx.chat.type === "private";
}

export function getCommandArgument(ctx: Context): string | undefined {
  if (
    !("message" in ctx) ||
    !ctx.message ||
    !("text" in ctx.message) ||
    typeof ctx.message.text !== "string"
  ) {
    return undefined;
  }
  const [, ...args] = ctx.message.text.trim().split(/\s+/);
  const argument = args.join(" ").trim();
  return argument || undefined;
}

export async function safeReply(
  reply: ReplyFn,
  message: string,
): Promise<{ message_id?: number } | undefined> {
  try {
    return await reply(message);
  } catch (error) {
    logger.exception("[telegram] failed to send reply", error, {
      component: "telegram",
      handler: "telegram",
      step: "reply",
      result: "error",
    });
    return undefined;
  }
}

export async function replyWithMainKeyboard(
  ctx: Pick<Context, "reply">,
  message: string,
): Promise<{ message_id?: number } | undefined> {
  return safeReply((text) => ctx.reply(text, MAIN_KEYBOARD), message);
}

export function formatModeHelp(mode: "text" | "voice"): string {
  return `${BOT_HELP_MESSAGE}\n\nТекущий режим ответа: ${mode}.`;
}
