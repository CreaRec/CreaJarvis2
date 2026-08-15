import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import type {
  ArchivePromoteResult,
  AttachmentStore,
  InboxItem,
  InboxStatus,
} from "./types.js";

export const DEFAULT_MAX_INBOX_FILES = 10;
export const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_MAX_INBOX_TOTAL_BYTES = 50 * 1024 * 1024;

export interface FsAttachmentStoreOpts {
  rootDir: string;
  maxInboxFiles?: number;
  maxFileBytes?: number;
  maxInboxTotalBytes?: number;
}

type Manifest = { items: InboxItem[] };

function sanitizeUserId(userId: string): string {
  const id = userId.trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error("Invalid userId");
  }
  return id;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      const s = await stat(full);
      total += s.size;
    }
  }
  return total;
}

export class FsAttachmentStore implements AttachmentStore {
  private readonly rootDir: string;
  private readonly maxInboxFiles: number;
  private readonly maxFileBytes: number;
  private readonly maxInboxTotalBytes: number;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(opts: FsAttachmentStoreOpts) {
    this.rootDir = path.resolve(opts.rootDir);
    this.maxInboxFiles = opts.maxInboxFiles ?? DEFAULT_MAX_INBOX_FILES;
    this.maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.maxInboxTotalBytes =
      opts.maxInboxTotalBytes ?? DEFAULT_MAX_INBOX_TOTAL_BYTES;
  }

  private inboxDir(userId: string): string {
    return path.join(this.rootDir, "inbox", userId);
  }

  private archiveDir(userId: string): string {
    return path.join(this.rootDir, "archive", userId);
  }

  private abandonedDir(userId: string): string {
    return path.join(this.rootDir, "abandoned", userId);
  }

  private manifestPath(userId: string): string {
    return path.join(this.inboxDir(userId), "manifest.json");
  }

  private async withUserLock<T>(
    userId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.locks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((r) => {
      release = r;
    });
    const chain = prev.then(() => done);
    this.locks.set(userId, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async readManifest(userId: string): Promise<Manifest> {
    try {
      const raw = await readFile(this.manifestPath(userId), "utf8");
      const parsed = JSON.parse(raw) as Manifest;
      if (!parsed || !Array.isArray(parsed.items)) return { items: [] };
      return { items: parsed.items };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { items: [] };
      throw err;
    }
  }

  private async writeManifest(
    userId: string,
    manifest: Manifest,
  ): Promise<void> {
    await mkdir(this.inboxDir(userId), { recursive: true });
    await writeFile(
      this.manifestPath(userId),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }

  private statusFrom(manifest: Manifest): InboxStatus {
    const totalBytes = manifest.items.reduce((s, i) => s + i.sizeBytes, 0);
    return {
      count: manifest.items.length,
      totalBytes,
      items: [...manifest.items],
    };
  }

  async add(
    userId: string,
    bytes: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<InboxStatus> {
    const id = sanitizeUserId(userId);
    if (bytes.length <= 0) throw new Error("Empty file");
    if (bytes.length > this.maxFileBytes) {
      throw new Error(
        `File too large (${bytes.length} bytes; max ${this.maxFileBytes})`,
      );
    }
    const safeName =
      filename.trim().replace(/[/\\]/g, "_").slice(0, 200) || "file";
    const mime = mimeType.trim() || "application/octet-stream";

    return this.withUserLock(id, async () => {
      const manifest = await this.readManifest(id);
      if (manifest.items.length >= this.maxInboxFiles) {
        throw new Error(
          `Inbox full (max ${this.maxInboxFiles} files)`,
        );
      }
      const total = manifest.items.reduce((s, i) => s + i.sizeBytes, 0);
      if (total + bytes.length > this.maxInboxTotalBytes) {
        throw new Error(
          `Inbox total size exceeded (max ${this.maxInboxTotalBytes} bytes)`,
        );
      }

      const itemId = randomUUID();
      const storagePath = path.join(this.inboxDir(id), itemId);
      await mkdir(this.inboxDir(id), { recursive: true });
      await writeFile(storagePath, bytes);

      const item: InboxItem = {
        id: itemId,
        filename: safeName,
        mimeType: mime,
        sizeBytes: bytes.length,
        storagePath,
        createdAt: new Date().toISOString(),
      };
      manifest.items.push(item);
      await this.writeManifest(id, manifest);
      return this.statusFrom(manifest);
    });
  }

  async status(userId: string): Promise<InboxStatus> {
    const id = sanitizeUserId(userId);
    return this.withUserLock(id, async () =>
      this.statusFrom(await this.readManifest(id)),
    );
  }

  async readAll(
    userId: string,
  ): Promise<Array<InboxItem & { bytes: Buffer }>> {
    const id = sanitizeUserId(userId);
    return this.withUserLock(id, async () => {
      const manifest = await this.readManifest(id);
      const out: Array<InboxItem & { bytes: Buffer }> = [];
      for (const item of manifest.items) {
        const bytes = await readFile(item.storagePath);
        out.push({ ...item, bytes });
      }
      return out;
    });
  }

  async clearPending(userId: string): Promise<void> {
    const id = sanitizeUserId(userId);
    await this.withUserLock(id, async () => {
      const manifest = await this.readManifest(id);
      if (manifest.items.length === 0) {
        await this.writeManifest(id, { items: [] });
        return;
      }
      await mkdir(this.abandonedDir(id), { recursive: true });
      for (const item of manifest.items) {
        const dest = path.join(
          this.abandonedDir(id),
          `${item.id}__${item.filename}`,
        );
        try {
          await rename(item.storagePath, dest);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      await this.writeManifest(id, { items: [] });
    });
  }

  async promoteAllToArchive(
    userId: string,
  ): Promise<ArchivePromoteResult[]> {
    const id = sanitizeUserId(userId);
    return this.withUserLock(id, async () => {
      const manifest = await this.readManifest(id);
      const results: ArchivePromoteResult[] = [];
      await mkdir(this.archiveDir(id), { recursive: true });

      for (const item of manifest.items) {
        const attachmentId = randomUUID();
        const dest = path.join(this.archiveDir(id), attachmentId);
        const bytes = await readFile(item.storagePath);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        await rename(item.storagePath, dest);
        results.push({
          attachmentId,
          storagePath: dest,
          filename: item.filename,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          sha256,
        });
      }
      await this.writeManifest(id, { items: [] });
      return results;
    });
  }

  async readArchiveFile(storagePath: string): Promise<Buffer> {
    const resolved = path.resolve(storagePath);
    const root = this.rootDir + path.sep;
    if (!resolved.startsWith(root) && resolved !== this.rootDir) {
      throw new Error("Invalid storage path");
    }
    return readFile(resolved);
  }

  async measureDiskUsage(): Promise<{
    inboxBytes: number;
    archiveBytes: number;
    totalBytes: number;
  }> {
    const inboxBytes = await dirSize(path.join(this.rootDir, "inbox"));
    const archiveBytes =
      (await dirSize(path.join(this.rootDir, "archive"))) +
      (await dirSize(path.join(this.rootDir, "abandoned")));
    return {
      inboxBytes,
      archiveBytes,
      totalBytes: inboxBytes + archiveBytes,
    };
  }
}
