import { describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "./turn.js";
import { ToolGateway } from "../tools/gateway.js";

describe("runAgentTurn", () => {
  it("returns assistant text without tools", async () => {
    const tools = new ToolGateway();
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: { role: "assistant", content: "Привет" },
            finish_reason: "stop",
          },
        ],
      }),
    );

    const result = await runAgentTurn({
      apiKey: "sk",
      model: "gpt-4o",
      instructions: "sys",
      userText: "hi",
      tools,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.text).toBe("Привет");
    expect(result.iterations).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("executes tool calls then returns final text", async () => {
    const tools = new ToolGateway();
    tools.register({
      name: "ping",
      description: "ping",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ok: true, data: { pong: true } }),
    });

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "ping", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: { role: "assistant", content: "pong" },
              finish_reason: "stop",
            },
          ],
        }),
      );

    const result = await runAgentTurn({
      apiKey: "sk",
      model: "gpt-4o",
      instructions: "sys",
      userText: "ping me",
      tools,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.text).toBe("pong");
    expect(result.iterations).toBe(2);
    expect(result.toolResults).toEqual([
      { name: "ping", result: { ok: true, data: { pong: true } } },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("includes prior messages between system and current user", async () => {
    const tools = new ToolGateway();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(body.messages.map((m) => m.role)).toEqual([
        "system",
        "user",
        "assistant",
        "user",
      ]);
      expect(body.messages[1]?.content).toBe("раньше");
      expect(body.messages[2]?.content).toBe("ок");
      expect(body.messages[3]?.content).toBe("сейчас");
      return Response.json({
        choices: [
          {
            message: { role: "assistant", content: "да" },
            finish_reason: "stop",
          },
        ],
      });
    });

    const result = await runAgentTurn({
      apiKey: "sk",
      model: "gpt-4o",
      instructions: "sys",
      userText: "сейчас",
      priorMessages: [
        { role: "user", content: "раньше" },
        { role: "assistant", content: "ок" },
      ],
      tools,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.text).toBe("да");
  });

  it("throws when max iterations exceeded", async () => {
    const tools = new ToolGateway();
    tools.register({
      name: "loop",
      description: "loop",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ok: true, data: {} }),
    });

    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_x",
                  type: "function",
                  function: { name: "loop", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
    );

    await expect(
      runAgentTurn({
        apiKey: "sk",
        model: "gpt-4o",
        instructions: "sys",
        userText: "go",
        tools,
        maxIterations: 2,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/max iterations/);
  });
});
