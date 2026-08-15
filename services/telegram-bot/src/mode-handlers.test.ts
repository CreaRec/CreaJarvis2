import { describe, expect, it, vi } from "vitest";
import { ModeHandlers } from "./mode-handlers.js";
import { MAIN_KEYBOARD } from "./telegram-ctx.js";
import type { UsersStore } from "./users-store.js";

describe("ModeHandlers", () => {
  it("sets mode for allowlisted user", async () => {
    const users: UsersStore = {
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
      MAIN_KEYBOARD,
    );
  });

  it("attaches main keyboard on /start", async () => {
    const users: UsersStore = {
      isAllowed: vi.fn(async () => true),
      getReplyMode: vi.fn(async () => "voice" as const),
      setReplyMode: vi.fn(async (_id, m) => m),
    };
    const handlers = new ModeHandlers(users);
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
    };
    await handlers.handleStart(ctx as never, 1);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, extra] = ctx.reply.mock.calls[0]!;
    expect(text).toContain("Текущий режим ответа: voice.");
    expect(extra).toBe(MAIN_KEYBOARD);
  });
});
