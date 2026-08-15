import { describe, expect, it, vi } from "vitest";
import { ModeHandlers } from "./mode-handlers.js";
import { mainKeyboard } from "./telegram-ctx.js";
import type { UsersStoreLike } from "./users-store.js";

describe("ModeHandlers", () => {
  it("sets mode for allowlisted user", async () => {
    const users: UsersStoreLike = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => "text" as const),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const handlers = new ModeHandlers(users);
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
      message: { text: "/mode voice" },
    };
    await handlers.handleMode(ctx as never, 1);
    expect(users.setReplyMode).toHaveBeenCalledWith(1, "voice");
    expect(ctx.reply).toHaveBeenCalledWith(
      "Ок, буду отвечать голосом.",
      mainKeyboard("voice"),
    );
  });

  it("toggles reply mode from the keyboard button", async () => {
    let mode: "text" | "voice" = "text";
    const users: UsersStoreLike = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => mode),
      setReplyMode: vi.fn(async (_id, m) => {
        mode = m;
        return m;
      }),
    };
    const handlers = new ModeHandlers(users);
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
    };
    await handlers.handleModeButton(ctx as never, 1, "text");
    expect(users.setReplyMode).toHaveBeenCalledWith(1, "voice");
    expect(ctx.reply).toHaveBeenCalledWith(
      "Ок, буду отвечать голосом.",
      mainKeyboard("voice"),
    );

    await handlers.handleModeButton(ctx as never, 1, "voice");
    expect(users.setReplyMode).toHaveBeenLastCalledWith(1, "text");
    expect(ctx.reply).toHaveBeenLastCalledWith(
      "Ок, буду отвечать текстом.",
      mainKeyboard("text"),
    );
  });

  it("attaches current-mode keyboard on /start", async () => {
    const users: UsersStoreLike = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => "voice" as const),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const handlers = new ModeHandlers(users);
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
    };
    await handlers.handleStart(ctx as never, 1);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Текущий режим ответа: voice."),
      mainKeyboard("voice"),
    );
  });
});
