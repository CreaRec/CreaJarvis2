import { openaiErrorMessage } from "./errors.js";

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
}): Promise<ChatCompletionResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
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

  const response = await fetchImpl(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const json = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      `OpenAI chat failed (${response.status}): ${openaiErrorMessage(json)}`,
    );
  }

  const parsed = json as ChatCompletionResponse;
  if (!parsed?.choices?.[0]?.message) {
    throw new Error("OpenAI chat response missing choices[0].message");
  }
  return parsed;
}
