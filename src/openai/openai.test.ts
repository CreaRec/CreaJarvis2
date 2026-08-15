import { describe, expect, it, vi } from "vitest";
import { logger } from "../log.js";
import { createChatCompletion } from "./chat.js";
import { openAiFilePurposeForMime } from "./files.js";
import { createResponse } from "./responses.js";

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
      Response.json({ error: { message: "invalid api key" } }, { status: 401 }),
    );
    await expect(
      createChatCompletion({
        apiKey: "sk",
        model: "gpt-4o",
        messages: [{ role: "user", content: "x" }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/invalid api key/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries createResponse after a 429 then returns output", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Please try again in 1s." } },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "resp_ok",
          output_text: "ok",
          output: [],
        }),
      );

    const result = await createResponse({
      apiKey: "sk",
      model: "gpt-4o",
      input: [{ role: "user", content: "hi" }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    expect(result.outputText).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("uses vision purpose for images and user_data for documents", () => {
    expect(openAiFilePurposeForMime("image/jpeg")).toBe("vision");
    expect(openAiFilePurposeForMime("IMAGE/PNG")).toBe("vision");
    expect(openAiFilePurposeForMime("application/pdf")).toBe("user_data");
  });
});
