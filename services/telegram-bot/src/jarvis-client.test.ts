import { describe, expect, it, vi } from "vitest";
import { jarvisAgentTurn } from "./jarvis-client.js";

describe("jarvisAgentTurn", () => {
  it("posts text and returns reply", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, text: "ответ" }),
    );
    const text = await jarvisAgentTurn({
      baseUrl: "http://core:8787/",
      token: "secret-token",
      text: "привет",
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
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/boom/);
  });
});
