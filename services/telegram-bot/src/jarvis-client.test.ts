import { describe, expect, it, vi } from "vitest";
import { jarvisAgentTurn, jarvisClearSession } from "./jarvis-client.js";

describe("jarvisAgentTurn", () => {
  it("posts text and userId and returns reply", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, text: "ответ" }),
    );
    const text = await jarvisAgentTurn({
      baseUrl: "http://core:8787/",
      token: "secret-token",
      text: "привет",
      userId: "123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(text).toBe("ответ");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://core:8787/internal/agent/turn",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
        body: JSON.stringify({ text: "привет", userId: "123" }),
      }),
    );
  });

  it("throws on error payload", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: false, error: "boom" }, { status: 500 }),
    );
    await expect(
      jarvisAgentTurn({
        baseUrl: "http://core:8787",
        token: "t",
        text: "x",
        userId: "1",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/boom/);
  });
});

describe("jarvisClearSession", () => {
  it("posts userId to clear endpoint", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    await jarvisClearSession({
      baseUrl: "http://core:8787/",
      token: "secret-token",
      userId: "99",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://core:8787/internal/agent/session/clear",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ userId: "99" }),
      }),
    );
  });
});
