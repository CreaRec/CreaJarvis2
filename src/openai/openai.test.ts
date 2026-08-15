import { describe, expect, it, vi } from "vitest";
import { createChatCompletion } from "./chat.js";

describe("openai http clients", () => {
  it("createChatCompletion maps tools and returns message", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tools?: unknown[];
        tool_choice?: string;
      };
      expect(body.tools).toHaveLength(1);
      expect(body.tool_choice).toBe("auto");
      return Response.json({
        choices: [{ message: { role: "assistant", content: "ok" } }],
      });
    });

    const result = await createChatCompletion({
      apiKey: "sk",
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "t",
          description: "d",
          parameters: { type: "object" },
        },
      ],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.choices[0]!.message.content).toBe("ok");
  });

  it("surfaces OpenAI error bodies", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: "rate limit" } }, { status: 429 }),
    );
    await expect(
      createChatCompletion({
        apiKey: "sk",
        model: "gpt-4o",
        messages: [{ role: "user", content: "x" }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/rate limit/);
  });
});
