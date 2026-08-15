import { describe, expect, it } from "vitest";
import {
  BTN_MODE,
  BTN_NEW,
  MAIN_KEYBOARD,
  matchKeyboardAction,
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
});
