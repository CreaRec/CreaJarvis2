import {
  createChatCompletion,
  type ChatFetch,
  type ChatMessage,
  type ChatToolCall,
} from "../openai/chat.js";
import {
  parseJsonArgs,
  type ToolGateway,
  type ToolResult,
} from "../tools/gateway.js";
import {
  logToolCallFinished,
  toolArgsSummaryAttrs,
} from "../tools/tool-log.js";
import { logger } from "../log.js";
import { classifyError } from "../telemetry.js";

export interface AgentTurnResult {
  text: string;
  iterations: number;
  toolResults: Array<{ name: string; result: ToolResult }>;
}

export interface RunAgentTurnInput {
  apiKey: string;
  model: string;
  instructions: string;
  userText: string;
  tools: ToolGateway;
  /** Prior user/assistant turns (no system); injected between system and current user. */
  priorMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  maxIterations?: number;
  fetchImpl?: ChatFetch;
}

const DEFAULT_MAX_ITERATIONS = 8;

export async function runAgentTurn(
  input: RunAgentTurnInput,
): Promise<AgentTurnResult> {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const prior = (input.priorMessages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const messages: ChatMessage[] = [
    { role: "system", content: input.instructions },
    ...prior,
    { role: "user", content: input.userText },
  ];
  const toolDefs = input.tools.listTools();
  const toolResults: Array<{ name: string; result: ToolResult }> = [];

  for (let i = 0; i < maxIterations; i++) {
    const completion = await createChatCompletion({
      apiKey: input.apiKey,
      model: input.model,
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      fetchImpl: input.fetchImpl,
    });

    const message = completion.choices[0]!.message;
    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const text = (message.content ?? "").trim();
      if (!text) {
        throw new Error("Agent turn returned empty assistant text");
      }
      return { text, iterations: i + 1, toolResults };
    }

    messages.push({
      role: "assistant",
      content: message.content,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const executed = await executeToolCall(input.tools, call);
      toolResults.push(executed);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(executed.result),
      });
    }
  }

  throw new Error(`Agent turn exceeded max iterations (${maxIterations})`);
}

async function executeToolCall(
  tools: ToolGateway,
  call: ChatToolCall,
): Promise<{ name: string; result: ToolResult }> {
  const name = call.function?.name ?? "";
  const argsStr = call.function?.arguments ?? "{}";
  const args = parseJsonArgs(argsStr);

  logger.info("[agent] tool call", {
    component: "agent",
    handler: "tool",
    step: "start",
    tool: name,
    ...toolArgsSummaryAttrs(args),
  });

  const started = Date.now();
  try {
    const result = await tools.execute(name, args);
    logToolCallFinished({
      message: "[agent] tool call finished",
      component: "agent",
      tool: name,
      args,
      result,
      durationMs: Date.now() - started,
    });
    return { name, result };
  } catch (err) {
    logger.exception("[agent] tool execute failed", err, {
      component: "agent",
      handler: "tool",
      step: "finish",
      tool: name,
      result: "error",
      error_type: classifyError(err),
      duration_ms: Date.now() - started,
      ...toolArgsSummaryAttrs(args),
    });
    return {
      name,
      result: {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
