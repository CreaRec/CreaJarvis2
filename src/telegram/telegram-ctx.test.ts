import { describe, expect, it } from "vitest";
import {
  BOT_PRIVATE_MESSAGE,
  formatModeHelp,
  getCommandArgument,
  isPrivateChat,
} from "./telegram-ctx.js";

describe("telegram-ctx", () => {
  it("detects private chats", () => {
    expect(isPrivateChat({ chat: { type: "private", id: 1 } } as never)).toBe(
      true,
    );
    expect(isPrivateChat({ chat: { type: "group", id: 1 } } as never)).toBe(
      false,
    );
  });

  it("parses command arguments", () => {
    expect(
      getCommandArgument({
        message: { text: "/mode voice" },
      } as never),
    ).toBe("voice");
    expect(
      getCommandArgument({
        message: { text: "/mode" },
      } as never),
    ).toBeUndefined();
  });

  it("formats help with mode", () => {
    expect(formatModeHelp("text")).toContain("text");
    expect(formatModeHelp("voice")).toContain("voice");
    expect(BOT_PRIVATE_MESSAGE).toMatch(/private/i);
  });
});
