import { describe, expect, it, vi } from "vitest";
import { ChatHandlers } from "./chat-handlers.js";
import type { BotConfig } from "./config.js";
import { mainKeyboard } from "./telegram-ctx.js";
import type { UsersStoreLike } from "./users-store.js";

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
    MAX_ATTACHMENT_BYTES: 1_000_000,
    MEDIA_GROUP_DEBOUNCE_MS: 50,
  };
}

describe("ChatHandlers", () => {
  it("proxies text to jarvis with userId and replies", async () => {
    const users: UsersStoreLike = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => "text" as const),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const agentTurn = vi.fn(async () => "ответ");
    const handlers = new ChatHandlers({
      config: makeConfig(),
      users,
      agentTurn,
    });
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
      replyWithChatAction: vi.fn(async () => true),
    };
    await handlers.handleText(ctx as never, 42, "привет");
    expect(agentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "привет",
        userId: "42",
      }),
    );
    expect(ctx.reply).toHaveBeenCalledWith("ответ", mainKeyboard("text"));
  });

  it("clears session on /new", async () => {
    const users: UsersStoreLike = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => "text" as const),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const clearSession = vi.fn(async () => undefined);
    const handlers = new ChatHandlers({
      config: makeConfig(),
      users,
      clearSession,
    });
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
    };
    await handlers.handleNew(ctx as never, 7);
    expect(clearSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "7" }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      "Контекст сброшен.",
      mainKeyboard("text"),
    );
  });

  it("stages photo without caption via inboxAdd", async () => {
    const users: UsersStoreLike = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => "text" as const),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const inboxAdd = vi.fn(async () => ({ count: 1, totalBytes: 10 }));
    const ctx = {
      message: {
        photo: [{ file_id: "p1", width: 10, height: 10, file_size: 10 }],
      },
      reply: vi.fn(async () => ({ message_id: 1 })),
      telegram: {
        getFileLink: vi.fn(async () => ({ href: "http://file" })),
      },
    };
    const fetchImpl = vi.fn(
      async () => new Response(Buffer.from("jpegdata"), { status: 200 }),
    );
    const handlers = new ChatHandlers({
      config: makeConfig(),
      users,
      inboxAdd,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await handlers.handlePhoto(ctx as never, 7);
    expect(inboxAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "7",
        filename: "photo.jpg",
        mimeType: "image/jpeg",
      }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Сохранил (1)"),
      mainKeyboard("text"),
    );
  });
});
