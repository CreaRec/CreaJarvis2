import { describe, expect, it, vi } from "vitest";
import {
  BTN_MODE,
  BTN_NEW,
  MAIN_KEYBOARD,
  matchKeyboardAction,
  replyWithMainKeyboard,
} from "./telegram-ctx.js";

describe("telegram keyboard", () => {
  it("exposes mode and new reply buttons", () => {
    expect(MAIN_KEYBOARD.reply_markup).toMatchObject({
      keyboard: [[BTN_MODE, BTN_NEW]],
      resize_keyboard: true,
      is_persistent: true,
    });
  });

  it("matches keyboard button labels", () => {
    expect(matchKeyboardAction("mode")).toBe("mode");
    expect(matchKeyboardAction(" New ")).toBe("new");
    expect(matchKeyboardAction("привет")).toBeUndefined();
  });

  it("attaches main keyboard on every reply helper call", async () => {
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
    };
    await replyWithMainKeyboard(ctx as never, "привет");
    expect(ctx.reply).toHaveBeenCalledWith("привет", MAIN_KEYBOARD);
  });
});
