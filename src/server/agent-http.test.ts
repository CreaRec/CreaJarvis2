import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAgentTurnHttp } from "./agent-http.js";
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

describe("handleAgentTurnHttp", () => {
  it("rejects unauthorized", async () => {
    const res = mockRes();
    await handleAgentTurnHttp(mockReq({ text: "hi" }), res, {
      apiKey: "sk",
      model: "gpt-4o",
      tools: new ToolGateway(),
      getInstructions: async () => "sys",
      tokensEqual: (a, b) => a === b,
      gatewayToken: "secret-token",
      extractBearer: () => null,
      readJsonBody: async () => ({ text: "hi" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("runs turn and returns text", async () => {
    const res = mockRes();
    await handleAgentTurnHttp(mockReq({ text: "hi" }, "Bearer secret-token"), res, {
      apiKey: "sk",
      model: "gpt-4o",
      tools: new ToolGateway(),
      getInstructions: async () => "sys",
      tokensEqual: (a, b) => a === b,
      gatewayToken: "secret-token",
      extractBearer: () => "secret-token",
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

  it("rejects empty text", async () => {
    const res = mockRes();
    await handleAgentTurnHttp(mockReq({ text: "  " }), res, {
      apiKey: "sk",
      model: "gpt-4o",
      tools: new ToolGateway(),
      getInstructions: async () => "sys",
      tokensEqual: (a, b) => a === b,
      gatewayToken: "secret-token",
      extractBearer: () => "secret-token",
      readJsonBody: async () => ({ text: "  " }),
    });
    expect(res.statusCode).toBe(400);
  });
});
