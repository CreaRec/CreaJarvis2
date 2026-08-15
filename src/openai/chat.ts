import { openaiPostJson, type SleepFn } from "./retry.js";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatHistoryMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ChatMessage =
  | { role: "system"; content: string }
  | ChatHistoryMessage;

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatCompletionChoice {
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ChatToolCall[];
  };
  finish_reason?: string | null;
}

export interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
}

export type ChatFetch = typeof fetch;

export async function createChatCompletion(input: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  fetchImpl?: ChatFetch;
  sleep?: SleepFn;
}): Promise<ChatCompletionResponse> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = "auto";
  }

  const parsed = (await openaiPostJson({
    url: "https://api.openai.com/v1/chat/completions",
    apiKey: input.apiKey,
    body,
    fetchImpl: input.fetchImpl ?? fetch,
    errorPrefix: "OpenAI chat failed",
    sleep: input.sleep,
  })) as ChatCompletionResponse;
  if (!parsed?.choices?.[0]?.message) {
    throw new Error("OpenAI chat response missing choices[0].message");
  }
  return parsed;
}
