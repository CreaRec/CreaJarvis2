import { describe, expect, it, vi } from "vitest";
import { ChatHandlers } from "./chat-handlers.js";
import type { BotConfig } from "./config.js";
import type { UsersStore } from "./users-store.js";

function makeConfig(): BotConfig {
  return {
    TELEGRAM_BOT_TOKEN: "t",
    OPENAI_API_KEY: "sk",
    JARVIS_GATEWAY_TOKEN: "token-ok-1",
    JARVIS_BASE_URL: "http://core:8787",
    USERS_PATH: "data/users.json",
    STT_MODEL: "whisper-1",
    TTS_MODEL: "gpt-4o-mini-tts",
    TTS_VOICE: "marin",
    MAX_VOICE_BYTES: 1_000_000,
    MAX_VOICE_DURATION_SEC: 120,
  };
}

describe("ChatHandlers", () => {
  it("proxies text to jarvis and replies", async () => {
    const users: UsersStore = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => "text" as const),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const handlers = new ChatHandlers({
      config: makeConfig(),
      users,
      agentTurn: async () => "ответ",
    });
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
      replyWithChatAction: vi.fn(async () => true),
    };
    await handlers.handleText(ctx as never, 1, "привет");
    expect(ctx.reply).toHaveBeenCalledWith("ответ");
  });
});
