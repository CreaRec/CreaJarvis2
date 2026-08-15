import { describe, expect, it, vi } from "vitest";
import {
  BTN_MODE_TEXT,
  BTN_MODE_VOICE,
  BTN_NEW,
  mainKeyboard,
  matchKeyboardAction,
  otherReplyMode,
  replyWithMainKeyboard,
} from "./telegram-ctx.js";

describe("telegram keyboard", () => {
  it("shows the current reply mode on the toggle button", () => {
    expect(mainKeyboard("text").reply_markup).toMatchObject({
      keyboard: [[BTN_MODE_TEXT, BTN_NEW]],
      resize_keyboard: true,
      is_persistent: true,
    });
    expect(mainKeyboard("voice").reply_markup).toMatchObject({
      keyboard: [[BTN_MODE_VOICE, BTN_NEW]],
    });
  });

  it("matches keyboard button labels", () => {
    expect(matchKeyboardAction("text")).toBe("text");
    expect(matchKeyboardAction(" Voice ")).toBe("voice");
    expect(matchKeyboardAction("mode")).toBeUndefined();
    expect(matchKeyboardAction(" New ")).toBe("new");
    expect(matchKeyboardAction("привет")).toBeUndefined();
  });

  it("flips the current reply mode", () => {
    expect(otherReplyMode("text")).toBe("voice");
    expect(otherReplyMode("voice")).toBe("text");
  });

  it("attaches the mode keyboard on every reply helper call", async () => {
    const ctx = {
      reply: vi.fn(async () => ({ message_id: 1 })),
    };
    await replyWithMainKeyboard(ctx as never, "привет", "voice");
    expect(ctx.reply).toHaveBeenCalledWith("привет", mainKeyboard("voice"));
  });
});
