import { beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramSettingsStore } from "./settings-store.js";

describe("TelegramSettingsStore", () => {
  const findUnique = vi.fn();
  const update = vi.fn();
  const db = {
    telegramChatSettings: { findUnique, update },
  };

  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it("isAllowed is true only when a row exists", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      telegramUserId: 42n,
    });
    const store = new TelegramSettingsStore(db as never);
    await expect(store.isAllowed(1)).resolves.toBe(false);
    await expect(store.isAllowed(42)).resolves.toBe(true);
  });

  it("defaults to text when no row", async () => {
    findUnique.mockResolvedValue(null);
    const store = new TelegramSettingsStore(db as never);
    await expect(store.getReplyMode(42)).resolves.toBe("text");
    expect(findUnique).toHaveBeenCalledWith({
      where: { telegramUserId: 42n },
      select: { replyMode: true },
    });
  });

  it("returns stored mode", async () => {
    findUnique.mockResolvedValue({ replyMode: "voice" });
    const store = new TelegramSettingsStore(db as never);
    await expect(store.getReplyMode(7)).resolves.toBe("voice");
  });

  it("updates mode without creating rows", async () => {
    update.mockResolvedValue({ replyMode: "voice" });
    const store = new TelegramSettingsStore(db as never);
    await expect(store.setReplyMode(7, "voice")).resolves.toBe("voice");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { telegramUserId: 7n },
        data: { replyMode: "voice" },
      }),
    );
  });
});
