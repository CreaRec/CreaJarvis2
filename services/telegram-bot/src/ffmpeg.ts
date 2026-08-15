import { spawn } from "node:child_process";

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

export type SpawnFfmpeg = (
  command: string,
  args: string[],
) => {
  stdin: { end: (data: Buffer) => void } | null;
  stdout: {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
  } | null;
  stderr: {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
  } | null;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
  kill?: (signal?: string) => void;
};

export async function toTelegramVoiceOgg(
  input: Buffer,
  options: {
    ffmpegPath?: string;
    spawnImpl?: SpawnFfmpeg;
    timeoutMs?: number;
  } = {},
): Promise<Buffer> {
  if (input.length === 0) throw new FfmpegError("empty audio input");
  const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
  const spawnImpl = options.spawnImpl ?? defaultSpawn;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-c:a",
    "libopus",
    "-f",
    "ogg",
    "pipe:1",
  ];

  return await new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const child = spawnImpl(ffmpegPath, args);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const finish = (err: Error | null, data?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(data ?? Buffer.alloc(0));
    };
    const timer = setTimeout(() => {
      finish(new FfmpegError(`ffmpeg timed out after ${timeoutMs}ms`));
      try {
        child.kill?.("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", (err) => {
      finish(new FfmpegError(`ffmpeg spawn failed: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        finish(
          new FfmpegError(
            stderr
              ? `ffmpeg exited ${code}: ${stderr.slice(0, 400)}`
              : `ffmpeg exited ${code}`,
          ),
        );
        return;
      }
      const out = Buffer.concat(stdoutChunks);
      if (out.length === 0) {
        finish(new FfmpegError("ffmpeg produced empty output"));
        return;
      }
      finish(null, out);
    });
    try {
      child.stdin?.end(input);
    } catch (err) {
      finish(
        new FfmpegError(
          `ffmpeg stdin failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  });
}

function defaultSpawn(command: string, args: string[]) {
  return spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
}

export function looksLikeOgg(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x4f &&
    buf[1] === 0x67 &&
    buf[2] === 0x67 &&
    buf[3] === 0x53
  );
}
