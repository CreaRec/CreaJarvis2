import type { PrismaClient, TelegramReplyMode } from "@prisma/client";

export type ReplyMode = "text" | "voice";

export interface TelegramSettingsStoreApi {
  /** Presence of a row in telegram_chat_settings = allowed user. */
  isAllowed(telegramUserId: number): Promise<boolean>;
  getReplyMode(telegramUserId: number): Promise<ReplyMode>;
  setReplyMode(
    telegramUserId: number,
    replyMode: ReplyMode,
  ): Promise<ReplyMode>;
}

export class TelegramSettingsStore implements TelegramSettingsStoreApi {
  constructor(private readonly db: PrismaClient) {}

  async isAllowed(telegramUserId: number): Promise<boolean> {
    const row = await this.db.telegramChatSettings.findUnique({
      where: { telegramUserId: BigInt(telegramUserId) },
      select: { telegramUserId: true },
    });
    return row != null;
  }

  async getReplyMode(telegramUserId: number): Promise<ReplyMode> {
    const row = await this.db.telegramChatSettings.findUnique({
      where: { telegramUserId: BigInt(telegramUserId) },
      select: { replyMode: true },
    });
    return (row?.replyMode as ReplyMode | undefined) ?? "text";
  }

  /**
   * Updates reply mode for an existing allowed user only (no auto-create).
   * Add users manually: INSERT INTO telegram_chat_settings ...
   */
  async setReplyMode(
    telegramUserId: number,
    replyMode: ReplyMode,
  ): Promise<ReplyMode> {
    const mode = replyMode as TelegramReplyMode;
    const row = await this.db.telegramChatSettings.update({
      where: { telegramUserId: BigInt(telegramUserId) },
      data: { replyMode: mode },
      select: { replyMode: true },
    });
    return row.replyMode as ReplyMode;
  }
}
