import { describe, expect, it, vi } from "vitest";
import { runAgentTurn } from "./turn.js";
import { ToolGateway } from "../tools/gateway.js";
import { logger } from "../log.js";

function responsesText(text: string) {
  return Response.json({
    id: "resp_1",
    output_text: text,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
  });
}

function responsesToolCall(callId: string, name: string) {
  return Response.json({
    id: "resp_tool",
    output: [
      {
        type: "function_call",
        call_id: callId,
        name,
        arguments: "{}",
      },
    ],
  });
}

describe("runAgentTurn", () => {
  it("returns assistant text without tools", async () => {
    const tools = new ToolGateway();
    const fetchImpl = vi.fn(async () => responsesText("Привет"));

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
    const body = JSON.parse(
      String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]?.body ?? "{}"),
    );
    expect(body.instructions).toBe("sys");
    expect(body.input.at(-1)).toEqual({ role: "user", content: "hi" });
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
      .mockResolvedValueOnce(responsesToolCall("call_1", "ping"))
      .mockResolvedValueOnce(responsesText("pong"));

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
    expect(result.toolTranscript[0]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "ping", arguments: "{}" },
        },
      ],
    });
    expect(result.toolTranscript[1]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({
        ok: true,
        data: { pong: true, count: 1 },
      }),
    });
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

  it("includes prior tool transcript in Responses input", async () => {
    const tools = new ToolGateway();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        instructions?: string;
        input: Array<Record<string, unknown>>;
      };
      expect(body.instructions).toBe("sys");
      expect(body.input[0]).toEqual({ role: "user", content: "что сегодня" });
      expect(body.input[1]).toMatchObject({
        type: "function_call",
        call_id: "call_event",
        name: "schedule_search",
      });
      expect(body.input[2]).toEqual({
        type: "function_call_output",
        call_id: "call_event",
        output: '{"ok":true,"data":{"event_id":"event-1"}}',
      });
      expect(body.input[3]).toEqual({
        role: "assistant",
        content: "Встреча сегодня",
      });
      expect(body.input[4]).toEqual({ role: "user", content: "отмени её" });
      return responsesText("да");
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

  it("attaches OpenAI file ids on the user turn", async () => {
    const tools = new ToolGateway();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input: Array<{ content: unknown }>;
      };
      expect(body.input.at(-1)?.content).toEqual([
        { type: "input_text", text: "что на скрине?" },
        { type: "input_file", file_id: "file_abc" },
      ]);
      return responsesText("ошибка 500");
    });

    const result = await runAgentTurn({
      apiKey: "sk",
      model: "gpt-4o",
      instructions: "sys",
      userText: "что на скрине?",
      attachments: [{ fileId: "file_abc", filename: "a.png" }],
      tools,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.text).toBe("ошибка 500");
  });

  it("throws when max iterations exceeded", async () => {
    const tools = new ToolGateway();
    tools.register({
      name: "loop",
      description: "loop",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ok: true, data: {} }),
    });

    const fetchImpl = vi.fn(async () => responsesToolCall("call_x", "loop"));

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
