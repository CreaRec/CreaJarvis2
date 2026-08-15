import { describe, expect, it, vi } from "vitest";
import { ModeHandlers } from "./mode-handlers.js";
import type { TelegramSettingsStoreApi } from "./settings-store.js";

function makeSettings(): TelegramSettingsStoreApi {
  return {
    isAllowed: vi.fn(async () => true),
    getReplyMode: vi.fn(async () => "text" as const),
    setReplyMode: vi.fn(async (_id, m) => m),
  };
}

describe("ModeHandlers", () => {
  it("shows help on /start", async () => {
    const settings = makeSettings();
    const handlers = new ModeHandlers(settings);
    const ctx = { reply: vi.fn(async () => ({ message_id: 1 })) };
    await handlers.handleStart(ctx as never, 1);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("/mode"));
  });

  it("sets mode from argument", async () => {
    const settings = makeSettings();
    const handlers = new ModeHandlers(settings);
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
      message: { text: "/mode voice" },
    };
    await handlers.handleMode(ctx as never, 1);
    expect(settings.setReplyMode).toHaveBeenCalledWith(1, "voice");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringMatching(/голосом/));
  });

  it("rejects unknown mode", async () => {
    const settings = makeSettings();
    const handlers = new ModeHandlers(settings);
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
      message: { text: "/mode loud" },
    };
    await handlers.handleMode(ctx as never, 1);
    expect(settings.setReplyMode).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringMatching(/Неизвестный режим/),
    );
  });
});
