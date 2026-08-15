import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UsersStore } from "./users-store.js";

describe("UsersStore", () => {
  it("allowlists only keys present in users.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tg-users-"));
    const path = join(dir, "users.json");
    await writeFile(
      path,
      JSON.stringify({ "42": { replyMode: "voice" } }),
      "utf8",
    );
    const store = new UsersStore(path);
    await expect(store.isAllowed(42)).resolves.toBe(true);
    await expect(store.isAllowed(99)).resolves.toBe(false);
    await expect(store.getReplyMode(42)).resolves.toBe("voice");
    await expect(store.getReplyMode(99)).resolves.toBe("text");
  });

  it("updates replyMode without creating new users", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tg-users-"));
    const path = join(dir, "users.json");
    await writeFile(
      path,
      JSON.stringify({ "7": { replyMode: "text" } }),
      "utf8",
    );
    const store = new UsersStore(path);
    await expect(store.setReplyMode(7, "voice")).resolves.toBe("voice");
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      "7": { replyMode: string };
    };
    expect(raw["7"].replyMode).toBe("voice");
    await expect(store.setReplyMode(8, "voice")).rejects.toThrow(/allowlist/);
  });
});
