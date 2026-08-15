-- CreateEnum
CREATE TYPE "TelegramReplyMode" AS ENUM ('text', 'voice');

-- CreateTable
CREATE TABLE "telegram_chat_settings" (
    "telegramUserId" BIGINT NOT NULL,
    "replyMode" "TelegramReplyMode" NOT NULL DEFAULT 'text',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_chat_settings_pkey" PRIMARY KEY ("telegramUserId")
);
