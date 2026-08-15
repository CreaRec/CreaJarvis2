import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  FfmpegError,
  looksLikeOgg,
  toTelegramVoiceOgg,
  type SpawnFfmpeg,
} from "./ffmpeg.js";

function fakeSpawn(opts: {
  code?: number;
  stdout?: Buffer;
  stderr?: string;
  failSpawn?: boolean;
}): SpawnFfmpeg {
  return () => {
    const ee = new EventEmitter() as EventEmitter & {
      stdin: { end: (data: Buffer) => void };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill?: () => void;
    };
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    ee.stdout = stdout;
    ee.stderr = stderr;
    ee.stdin = {
      end: () => {
        queueMicrotask(() => {
          if (opts.failSpawn) {
            ee.emit("error", new Error("ENOENT"));
            return;
          }
          if (opts.stdout) stdout.emit("data", opts.stdout);
          if (opts.stderr) stderr.emit("data", opts.stderr);
          ee.emit("close", opts.code ?? 0);
        });
      },
    };
    return ee;
  };
}

describe("ffmpeg helpers", () => {
  it("detects Ogg magic", () => {
    expect(looksLikeOgg(Buffer.from("OggS...."))).toBe(true);
    expect(looksLikeOgg(Buffer.from("RIFF"))).toBe(false);
  });

  it("rejects empty input", async () => {
    await expect(toTelegramVoiceOgg(Buffer.alloc(0))).rejects.toBeInstanceOf(
      FfmpegError,
    );
  });

  it("returns stdout on success", async () => {
    const out = Buffer.from("OggS-out");
    const result = await toTelegramVoiceOgg(Buffer.from("in"), {
      spawnImpl: fakeSpawn({ stdout: out }),
    });
    expect(result.equals(out)).toBe(true);
  });

  it("surfaces non-zero exit", async () => {
    await expect(
      toTelegramVoiceOgg(Buffer.from("in"), {
        spawnImpl: fakeSpawn({ code: 1, stderr: "bad codec" }),
      }),
    ).rejects.toThrow(/bad codec/);
  });

  it("surfaces spawn errors", async () => {
    await expect(
      toTelegramVoiceOgg(Buffer.from("in"), {
        spawnImpl: fakeSpawn({ failSpawn: true }),
      }),
    ).rejects.toThrow(/spawn failed/);
  });
});
