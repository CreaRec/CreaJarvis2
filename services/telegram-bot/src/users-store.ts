import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";

export type ReplyMode = "text" | "voice";

const userSchema = z.object({
  replyMode: z.enum(["text", "voice"]).default("text"),
});

const usersFileSchema = z.record(z.string(), userSchema);

export type UsersFile = z.infer<typeof usersFileSchema>;

export class UsersStore {
  constructor(private readonly path: string) {}

  async isAllowed(userId: number): Promise<boolean> {
    const users = await this.read();
    return String(userId) in users;
  }

  async getReplyMode(userId: number): Promise<ReplyMode> {
    const users = await this.read();
    return users[String(userId)]?.replyMode ?? "text";
  }

  /** Updates replyMode only for an existing allowlisted user. */
  async setReplyMode(userId: number, replyMode: ReplyMode): Promise<ReplyMode> {
    const users = await this.read();
    const key = String(userId);
    if (!(key in users)) {
      throw new Error(`user ${userId} is not in users.json allowlist`);
    }
    users[key] = { replyMode };
    await this.write(users);
    return replyMode;
  }

  private async read(): Promise<UsersFile> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw err;
    }
    const parsed = usersFileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Invalid users file at ${this.path}`);
    }
    return parsed.data;
  }

  private async write(users: UsersFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    const body = `${JSON.stringify(users, null, 2)}\n`;
    await writeFile(tmp, body, "utf8");
    await rename(tmp, this.path);
  }
}
