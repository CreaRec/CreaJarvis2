import { describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "./turn.js";
import { ToolGateway } from "../tools/gateway.js";
import { logger } from "../log.js";

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
    expect(result.toolTranscript).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("executes tool calls then returns final text", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const tools = new ToolGateway();
    tools.register({
      name: "ping",
      description: "ping",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ok: true, data: { pong: true, count: 1 } }),
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
      { name: "ping", result: { ok: true, data: { pong: true, count: 1 } } },
    ]);
    expect(result.toolTranscript).toEqual([
      {
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
      {
        role: "tool",
        tool_call_id: "call_1",
        content: JSON.stringify({
          ok: true,
          data: { pong: true, count: 1 },
        }),
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenCalledWith(
      "[agent] tool call finished",
      expect.objectContaining({
        tool: "ping",
        step: "finish",
        result: "success",
        count: 1,
      }),
    );
    infoSpy.mockRestore();
  });

  it("includes prior tool transcript between system and current user", async () => {
    const tools = new ToolGateway();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{
          role: string;
          content: string | null;
          tool_calls?: unknown[];
          tool_call_id?: string;
        }>;
      };
      expect(body.messages.map((m) => m.role)).toEqual([
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
      ]);
      expect(body.messages[1]?.content).toBe("что сегодня");
      expect(body.messages[2]?.tool_calls).toHaveLength(1);
      expect(body.messages[3]).toEqual({
        role: "tool",
        tool_call_id: "call_event",
        content: '{"ok":true,"data":{"event_id":"event-1"}}',
      });
      expect(body.messages[4]?.content).toBe("Встреча сегодня");
      expect(body.messages[5]?.content).toBe("отмени её");
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
      userText: "отмени её",
      priorMessages: [
        { role: "user", content: "что сегодня" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_event",
              type: "function",
              function: { name: "schedule_search", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_event",
          content: '{"ok":true,"data":{"event_id":"event-1"}}',
        },
        { role: "assistant", content: "Встреча сегодня" },
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
