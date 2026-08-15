import type { ChatFetch, ChatHistoryMessage, ChatToolDef } from "./chat.js";
import { openaiPostJson, type SleepFn } from "./retry.js";

export type ResponseInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_file"; file_id: string }
  | {
      type: "input_image";
      file_id: string;
      detail: "auto" | "low" | "high";
    }
  | { type: "output_text"; text: string };

export type ResponseInputItem =
  | {
      role: "user" | "assistant" | "system";
      content: string | ResponseInputContent[];
    }
  | {
      type: "function_call";
      id?: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

export interface ResponseFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
}

export interface ResponseOutputMessage {
  type: "message";
  role: "assistant";
  content: Array<{ type: string; text?: string }>;
}

export type ResponseOutputItem =
  | ResponseFunctionCall
  | ResponseOutputMessage
  | { type: string; [key: string]: unknown };

export interface CreateResponseResult {
  id: string;
  output: ResponseOutputItem[];
  outputText: string;
  functionCalls: ResponseFunctionCall[];
}

function extractOutputText(output: ResponseOutputItem[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (
          block &&
          typeof block === "object" &&
          "text" in block &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          parts.push((block as { text: string }).text);
        }
      }
    }
  }
  return parts.join("").trim();
}

function extractFunctionCalls(
  output: ResponseOutputItem[],
): ResponseFunctionCall[] {
  const calls: ResponseFunctionCall[] = [];
  for (const item of output) {
    if (item.type === "function_call") {
      const call = item as ResponseFunctionCall;
      if (
        typeof call.call_id === "string" &&
        typeof call.name === "string" &&
        typeof call.arguments === "string"
      ) {
        calls.push(call);
      }
    }
  }
  return calls;
}

export function historyToResponseInput(
  messages: ChatHistoryMessage[],
): ResponseInputItem[] {
  const out: ResponseInputItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const call of message.tool_calls) {
          out.push({
            type: "function_call",
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          });
        }
      } else if (message.content) {
        out.push({ role: "assistant", content: message.content });
      }
      continue;
    }
    if (message.role === "tool") {
      out.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      });
    }
  }
  return out;
}

export async function createResponse(input: {
  apiKey: string;
  model: string;
  instructions?: string;
  input: ResponseInputItem[];
  tools?: ChatToolDef[];
  fetchImpl?: ChatFetch;
  sleep?: SleepFn;
}): Promise<CreateResponseResult> {
  const body: Record<string, unknown> = {
    model: input.model,
    input: input.input,
  };
  if (input.instructions) {
    body.instructions = input.instructions;
  }
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    body.tool_choice = "auto";
  }

  const json = (await openaiPostJson({
    url: "https://api.openai.com/v1/responses",
    apiKey: input.apiKey,
    body,
    fetchImpl: input.fetchImpl ?? fetch,
    errorPrefix: "OpenAI responses failed",
    sleep: input.sleep,
  })) as {
    id?: string;
    output?: ResponseOutputItem[];
    output_text?: string;
  };
  const output = Array.isArray(json.output) ? json.output : [];
  const outputText =
    typeof json.output_text === "string" && json.output_text.trim()
      ? json.output_text.trim()
      : extractOutputText(output);
  return {
    id: typeof json.id === "string" ? json.id : "",
    output,
    outputText,
    functionCalls: extractFunctionCalls(output),
  };
}
