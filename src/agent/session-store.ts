import { createClient, type RedisClientType } from "redis";
import { logger } from "../log.js";
import type {
  ChatHistoryMessage,
  ChatToolCall,
} from "../openai/chat.js";
import { classifyError } from "../telemetry.js";

export type SessionMessage = ChatHistoryMessage;

export interface AgentSessionStore {
  getMessages(userId: string): Promise<SessionMessage[]>;
  appendTurn(
    userId: string,
    user: string,
    assistant: string,
    toolTranscript?: SessionMessage[],
  ): Promise<void>;
  clear(userId: string): Promise<void>;
}

export interface RedisCommands {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX: number },
  ): Promise<unknown>;
  del(key: string): Promise<number>;
}

const KEY_PREFIX = "agent:session:";

export function sessionKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function sanitizeUserId(userId: string): string {
  return userId.trim();
}

function isToolCall(value: unknown): value is ChatToolCall {
  if (!value || typeof value !== "object") return false;
  const call = value as ChatToolCall;
  return (
    typeof call.id === "string" &&
    call.type === "function" &&
    Boolean(call.function) &&
    typeof call.function.name === "string" &&
    typeof call.function.arguments === "string"
  );
}

function parseMessage(item: unknown): SessionMessage | null {
  if (!item || typeof item !== "object") return null;
  const message = item as Record<string, unknown>;
  if (message.role === "user" && typeof message.content === "string") {
    return { role: "user", content: message.content };
  }
  if (
    message.role === "tool" &&
    typeof message.tool_call_id === "string" &&
    typeof message.content === "string"
  ) {
    return {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: message.content,
    };
  }
  if (
    message.role === "assistant" &&
    (typeof message.content === "string" || message.content === null)
  ) {
    if (message.tool_calls === undefined) {
      return { role: "assistant", content: message.content };
    }
    if (
      Array.isArray(message.tool_calls) &&
      message.tool_calls.every(isToolCall)
    ) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      };
    }
  }
  return null;
}

function parseMessages(raw: string | null): SessionMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SessionMessage[] = [];
    for (const item of parsed) {
      const message = parseMessage(item);
      if (message) out.push(message);
    }
    return out;
  } catch {
    return [];
  }
}

function trimMessages(
  messages: SessionMessage[],
  maxMessages: number,
): SessionMessage[] {
  const userIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  const maxTurns = Math.max(1, Math.floor(maxMessages / 2));
  if (userIndexes.length <= maxTurns) return messages;
  return messages.slice(userIndexes[userIndexes.length - maxTurns]!);
}

/** In-memory store for unit tests (optional idle TTL via injected clock). */
export class MemoryAgentSessionStore implements AgentSessionStore {
  private readonly sessions = new Map<
    string,
    { messages: SessionMessage[]; expiresAt: number }
  >();

  constructor(
    private readonly opts: {
      ttlSeconds: number;
      maxMessages: number;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  async getMessages(userId: string): Promise<SessionMessage[]> {
    const id = sanitizeUserId(userId);
    if (!id) return [];
    const entry = this.sessions.get(id);
    if (!entry) return [];
    if (entry.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return [];
    }
    return entry.messages.map((m) => ({ ...m }));
  }

  async appendTurn(
    userId: string,
    user: string,
    assistant: string,
    toolTranscript: SessionMessage[] = [],
  ): Promise<void> {
    const id = sanitizeUserId(userId);
    if (!id) return;
    const prior = await this.getMessages(id);
    const messages = trimMessages(
      [
        ...prior,
        { role: "user", content: user },
        ...toolTranscript.filter((message) => message.role !== "user"),
        { role: "assistant", content: assistant },
      ],
      this.opts.maxMessages,
    );
    this.sessions.set(id, {
      messages,
      expiresAt: this.now() + this.opts.ttlSeconds * 1000,
    });
  }

  async clear(userId: string): Promise<void> {
    const id = sanitizeUserId(userId);
    if (!id) return;
    this.sessions.delete(id);
  }
}

export class RedisAgentSessionStore implements AgentSessionStore {
  constructor(
    private readonly redis: RedisCommands,
    private readonly opts: { ttlSeconds: number; maxMessages: number },
  ) {}

  async getMessages(userId: string): Promise<SessionMessage[]> {
    const id = sanitizeUserId(userId);
    if (!id) return [];
    try {
      const raw = await this.redis.get(sessionKey(id));
      return parseMessages(raw);
    } catch (err) {
      logger.exception("[agent] session load failed", err, {
        component: "agent",
        handler: "http",
        step: "session_load",
        result: "error",
        error_type: classifyError(err),
      });
      return [];
    }
  }

  async appendTurn(
    userId: string,
    user: string,
    assistant: string,
    toolTranscript: SessionMessage[] = [],
  ): Promise<void> {
    const id = sanitizeUserId(userId);
    if (!id) return;
    try {
      const prior = parseMessages(await this.redis.get(sessionKey(id)));
      const messages = trimMessages(
        [
          ...prior,
          { role: "user", content: user },
          ...toolTranscript.filter((message) => message.role !== "user"),
          { role: "assistant", content: assistant },
        ],
        this.opts.maxMessages,
      );
      await this.redis.set(sessionKey(id), JSON.stringify(messages), {
        EX: this.opts.ttlSeconds,
      });
    } catch (err) {
      logger.exception("[agent] session save failed", err, {
        component: "agent",
        handler: "http",
        step: "session_save",
        result: "error",
        error_type: classifyError(err),
      });
    }
  }

  async clear(userId: string): Promise<void> {
    const id = sanitizeUserId(userId);
    if (!id) return;
    try {
      await this.redis.del(sessionKey(id));
    } catch (err) {
      logger.exception("[agent] session clear failed", err, {
        component: "agent",
        handler: "http",
        step: "session_clear",
        result: "error",
        error_type: classifyError(err),
      });
      throw err;
    }
  }
}

export async function connectRedisClient(
  url: string,
): Promise<RedisClientType> {
  const client = createClient({ url }) as RedisClientType;
  client.on("error", (err) => {
    logger.exception("[agent] redis client error", err, {
      component: "agent",
      handler: "http",
      step: "redis",
      result: "error",
      error_type: classifyError(err),
    });
  });
  await client.connect();
  return client;
}
