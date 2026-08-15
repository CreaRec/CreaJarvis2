import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { FsAttachmentStore } from "../attachments/fs-store.js";
import { handleInboxAddHttp, handleInboxStatusHttp } from "./inbox-http.js";

function mockRes() {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(payload?: string) {
      this.body = payload ?? "";
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}

describe("inbox http", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  it("adds a file via raw body", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "jarvis-inbox-http-"));
    dirs.push(dir);
    const store = new FsAttachmentStore({ rootDir: dir });
    const bytes = Buffer.from("hello-file");
    const req = Readable.from([bytes]) as IncomingMessage;
    req.headers = {
      authorization: "Bearer secret",
      "x-jarvis-user-id": "42",
      "x-jarvis-filename": "a.txt",
      "x-jarvis-mime-type": "text/plain",
    };
    const res = mockRes();
    await handleInboxAddHttp(req, res, {
      store,
      tokensEqual: (a, b) => a === b,
      gatewayToken: "secret",
      extractBearer: () => "secret",
      readJsonBody: async () => ({}),
      maxFileBytes: 1_000_000,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, count: 1 });

    const statusReq = {
      url: "/internal/inbox/status?userId=42",
      headers: {},
    } as IncomingMessage;
    const statusRes = mockRes();
    await handleInboxStatusHttp(statusReq, statusRes, {
      store,
      tokensEqual: (a, b) => a === b,
      gatewayToken: "secret",
      extractBearer: () => "secret",
      readJsonBody: async () => ({}),
      maxFileBytes: 1_000_000,
    });
    expect(JSON.parse(statusRes.body)).toMatchObject({
      ok: true,
      count: 1,
      totalBytes: 10,
    });
  });

  it("rejects unauthorized", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "jarvis-inbox-http2-"));
    dirs.push(dir);
    const store = new FsAttachmentStore({ rootDir: dir });
    const req = Readable.from([Buffer.from("x")]) as IncomingMessage;
    req.headers = {
      "x-jarvis-user-id": "1",
      "x-jarvis-filename": "a.txt",
    };
    const res = mockRes();
    await handleInboxAddHttp(req, res, {
      store,
      tokensEqual: (a, b) => a === b,
      gatewayToken: "secret",
      extractBearer: () => null,
      readJsonBody: async () => ({}),
      maxFileBytes: 1_000_000,
    });
    expect(res.statusCode).toBe(401);
  });
});
