import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { FsAttachmentStore } from "./fs-store.js";

describe("FsAttachmentStore", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  async function tmpStore(): Promise<FsAttachmentStore> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "jarvis-att-"));
    dirs.push(dir);
    return new FsAttachmentStore({
      rootDir: dir,
      maxInboxFiles: 3,
      maxFileBytes: 1000,
      maxInboxTotalBytes: 2000,
    });
  }

  it("adds files and reports status", async () => {
    const store = await tmpStore();
    const status = await store.add(
      "u1",
      Buffer.from("hello"),
      "a.txt",
      "text/plain",
    );
    expect(status.count).toBe(1);
    expect(status.totalBytes).toBe(5);
    expect(status.items[0]?.filename).toBe("a.txt");
  });

  it("rejects oversize and full inbox", async () => {
    const store = await tmpStore();
    await expect(
      store.add("u1", Buffer.alloc(1001), "big.bin", "application/octet-stream"),
    ).rejects.toThrow(/too large/i);

    await store.add("u1", Buffer.from("a"), "1.txt", "text/plain");
    await store.add("u1", Buffer.from("b"), "2.txt", "text/plain");
    await store.add("u1", Buffer.from("c"), "3.txt", "text/plain");
    await expect(
      store.add("u1", Buffer.from("d"), "4.txt", "text/plain"),
    ).rejects.toThrow(/full/i);
  });

  it("promotes to archive via rename and clears manifest", async () => {
    const store = await tmpStore();
    await store.add("u1", Buffer.from("data"), "shot.png", "image/png");
    const promoted = await store.promoteAllToArchive("u1");
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.filename).toBe("shot.png");
    expect(promoted[0]?.sha256).toHaveLength(64);
    const bytes = await store.readArchiveFile(promoted[0]!.storagePath);
    expect(bytes.toString()).toBe("data");
    expect((await store.status("u1")).count).toBe(0);
  });

  it("clearPending moves to abandoned without unlinking content", async () => {
    const store = await tmpStore();
    await store.add("u1", Buffer.from("x"), "x.bin", "application/octet-stream");
    await store.clearPending("u1");
    expect((await store.status("u1")).count).toBe(0);
    const usage = await store.measureDiskUsage();
    expect(usage.totalBytes).toBeGreaterThan(0);
    expect(usage.archiveBytes).toBeGreaterThan(0);
  });

  it("measureDiskUsage splits inbox and archive", async () => {
    const store = await tmpStore();
    await store.add("u1", Buffer.from("inbox"), "i.txt", "text/plain");
    let usage = await store.measureDiskUsage();
    expect(usage.inboxBytes).toBeGreaterThan(0);
    await store.promoteAllToArchive("u1");
    usage = await store.measureDiskUsage();
    expect(usage.inboxBytes).toBeLessThan(usage.totalBytes);
    expect(usage.archiveBytes).toBeGreaterThan(0);
  });
});
