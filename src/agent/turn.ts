import type {
  ChatFetch,
  ChatHistoryMessage,
  ChatToolCall,
} from "../openai/chat.js";
import {
  createResponse,
  historyToResponseInput,
  type ResponseInputContent,
  type ResponseInputItem,
} from "../openai/responses.js";
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

export interface AgentTurnAttachment {
  fileId: string;
  filename: string;
  mimeType: string;
}

export interface AgentTurnResult {
  text: string;
  iterations: number;
  toolResults: Array<{ name: string; result: ToolResult }>;
  /** Assistant tool calls and their outputs, replayed on later turns. */
  toolTranscript: ChatHistoryMessage[];
}

export interface RunAgentTurnInput {
  apiKey: string;
  model: string;
  instructions: string;
  userText: string;
  tools: ToolGateway;
  /** Prior conversation and tool transcript (no system message). */
  priorMessages?: ChatHistoryMessage[];
  /** OpenAI Files API ids attached to the current user turn. */
  attachments?: AgentTurnAttachment[];
  /**
   * Extra file ids injected mid-loop (e.g. attachment_open).
   * Mutated by tools via turn context when provided.
   */
  pendingInputFiles?: AgentTurnAttachment[];
  maxIterations?: number;
  fetchImpl?: ChatFetch;
}

const DEFAULT_MAX_ITERATIONS = 8;
const ATTACHMENT_INSTRUCTIONS = [
  "Attachments in this turn are primary source material. Inspect every attachment independently and thoroughly before answering.",
  "Transcribe all relevant visible details exactly, including names, routes, dates, times, time zones, amounts, carriers, flight or train numbers, booking/confirmation codes, addresses, and status. Do not omit identifiers because a summary seems sufficient.",
  "When the user asks to add, save, remember, record, or retry saving information, persistence is part of the request: call the appropriate write tool in this same turn. For trip attachments, use theme_get when needed and theme_add_entry/theme_add_entries with kind=note; include all extracted booking details in the stored note(s).",
  "A conversational answer or attachment archive is not persistence into a theme, plan, reminder, calendar, or memory. Never say information was saved unless the corresponding write tool succeeded.",
].join("\n");

function attachmentContent(
  attachment: AgentTurnAttachment,
): ResponseInputContent {
  return attachment.mimeType.toLowerCase().startsWith("image/")
    ? {
        type: "input_image",
        file_id: attachment.fileId,
        detail: "high",
      }
    : { type: "input_file", file_id: attachment.fileId };
}

export async function runAgentTurn(
  input: RunAgentTurnInput,
): Promise<AgentTurnResult> {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const toolDefs = input.tools.listTools();
  const toolResults: Array<{ name: string; result: ToolResult }> = [];
  const toolTranscript: ChatHistoryMessage[] = [];
  const pendingInputFiles = input.pendingInputFiles ?? [];

  const userContent: ResponseInputContent[] = [
    { type: "input_text", text: input.userText },
  ];
  for (const att of input.attachments ?? []) {
    userContent.push(attachmentContent(att));
  }

  const responseInput: ResponseInputItem[] = [
    ...historyToResponseInput(input.priorMessages ?? []),
    {
      role: "user",
      content: userContent.length === 1 ? input.userText : userContent,
    },
  ];

  for (let i = 0; i < maxIterations; i++) {
    if (pendingInputFiles.length > 0) {
      const extra: ResponseInputContent[] = pendingInputFiles
        .splice(0)
        .map(attachmentContent);
      responseInput.push({
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Additional attachment(s) opened from archive:",
          },
          ...extra,
        ],
      });
    }

    const completion = await createResponse({
      apiKey: input.apiKey,
      model: input.model,
      instructions:
        (input.attachments?.length ?? 0) > 0
          ? `${input.instructions}\n\n${ATTACHMENT_INSTRUCTIONS}`
          : input.instructions,
      input: responseInput,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      fetchImpl: input.fetchImpl,
    });

    const toolCalls = completion.functionCalls;
    if (toolCalls.length === 0) {
      const text = completion.outputText.trim();
      if (!text) {
        throw new Error("Agent turn returned empty assistant text");
      }
      return { text, iterations: i + 1, toolResults, toolTranscript };
    }

    const chatToolCalls: ChatToolCall[] = toolCalls.map((call) => ({
      id: call.call_id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    }));

    const assistantToolMessage: ChatHistoryMessage = {
      role: "assistant",
      content: completion.outputText.trim() ? completion.outputText : null,
      tool_calls: chatToolCalls,
    };
    toolTranscript.push(assistantToolMessage);

    for (const call of toolCalls) {
      responseInput.push({
        type: "function_call",
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments,
        id: call.id,
      });
    }

    for (const call of toolCalls) {
      const executed = await executeToolCall(input.tools, {
        id: call.call_id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      });
      toolResults.push(executed);
      const toolMessage: ChatHistoryMessage = {
        role: "tool",
        tool_call_id: call.call_id,
        content: JSON.stringify(executed.result),
      };
      toolTranscript.push(toolMessage);
      responseInput.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(executed.result),
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
