import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  handleAgentSessionClearHttp,
  handleAgentTurnHttp,
} from "./agent-http.js";
import { MemoryAgentSessionStore } from "../agent/session-store.js";
import { ToolGateway } from "../tools/gateway.js";

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

function mockReq(body: unknown, auth?: string): IncomingMessage {
  const stream = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  stream.headers = auth ? { authorization: auth } : {};
  return stream;
}

const baseDeps = {
  apiKey: "sk",
  model: "gpt-4o",
  tools: new ToolGateway(),
  getInstructions: async () => "sys",
  tokensEqual: (a: string, b: string) => a === b,
  gatewayToken: "secret-token",
  extractBearer: () => "secret-token" as string | null,
  readJsonBody: async () => ({ text: "hi" }),
};

describe("handleAgentTurnHttp", () => {
  it("rejects unauthorized", async () => {
    const res = mockRes();
    await handleAgentTurnHttp(mockReq({ text: "hi" }), res, {
      ...baseDeps,
      extractBearer: () => null,
      readJsonBody: async () => ({ text: "hi" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("runs turn and returns text", async () => {
    const res = mockRes();
    await handleAgentTurnHttp(mockReq({ text: "hi" }, "Bearer secret-token"), res, {
      ...baseDeps,
      readJsonBody: async () => ({ text: "привет" }),
      runTurn: async () => ({
        text: "ответ",
        iterations: 1,
        toolResults: [],
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, text: "ответ" });
  });

  it("loads prior history and saves turn when userId present", async () => {
    const store = new MemoryAgentSessionStore({
      ttlSeconds: 1800,
      maxMessages: 12,
    });
    await store.appendTurn("42", "раньше", "ок");
    const res = mockRes();
    const runTurn = vi.fn(async (input: { priorMessages?: unknown }) => {
      expect(input.priorMessages).toEqual([
        { role: "user", content: "раньше" },
        { role: "assistant", content: "ок" },
      ]);
      return { text: "новое", iterations: 1, toolResults: [] };
    });

    await handleAgentTurnHttp(
      mockReq({ text: "сейчас", userId: "42" }, "Bearer secret-token"),
      res,
      {
        ...baseDeps,
        sessionStore: store,
        readJsonBody: async () => ({ text: "сейчас", userId: "42" }),
        runTurn: runTurn as never,
      },
    );

    expect(res.statusCode).toBe(200);
    expect(await store.getMessages("42")).toEqual([
      { role: "user", content: "раньше" },
      { role: "assistant", content: "ок" },
      { role: "user", content: "сейчас" },
      { role: "assistant", content: "новое" },
    ]);
  });

  it("works without userId (no session)", async () => {
    const store = new MemoryAgentSessionStore({
      ttlSeconds: 1800,
      maxMessages: 12,
    });
    const res = mockRes();
    await handleAgentTurnHttp(mockReq({ text: "hi" }, "Bearer secret-token"), res, {
      ...baseDeps,
      sessionStore: store,
      readJsonBody: async () => ({ text: "hi" }),
      runTurn: async (input) => {
        expect(input.priorMessages).toEqual([]);
        return { text: "ok", iterations: 1, toolResults: [] };
      },
    });
    expect(res.statusCode).toBe(200);
    expect(await store.getMessages("anyone")).toEqual([]);
  });

  it("rejects empty text", async () => {
    const res = mockRes();
    await handleAgentTurnHttp(mockReq({ text: "  " }), res, {
      ...baseDeps,
      readJsonBody: async () => ({ text: "  " }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("handleAgentSessionClearHttp", () => {
  it("clears session for userId", async () => {
    const store = new MemoryAgentSessionStore({
      ttlSeconds: 1800,
      maxMessages: 12,
    });
    await store.appendTurn("7", "a", "b");
    const res = mockRes();
    await handleAgentSessionClearHttp(
      mockReq({ userId: "7" }, "Bearer secret-token"),
      res,
      {
        ...baseDeps,
        sessionStore: store,
        readJsonBody: async () => ({ userId: "7" }),
      },
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(await store.getMessages("7")).toEqual([]);
  });

  it("rejects missing userId", async () => {
    const res = mockRes();
    await handleAgentSessionClearHttp(mockReq({}), res, {
      ...baseDeps,
      sessionStore: new MemoryAgentSessionStore({
        ttlSeconds: 60,
        maxMessages: 4,
      }),
      readJsonBody: async () => ({}),
    });
    expect(res.statusCode).toBe(400);
  });
});
