import type { MemoryStore } from "../memory/store.js";
import { hashFactContent } from "../memory/store.js";
import type { MemoryRetriever } from "../memory/types.js";
import { type ToolDefinition, z } from "./gateway.js";

const searchSchema = z.object({
  query: z.string().min(1),
  branch: z.enum(["user", "directives", "world"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const saveSchema = z.object({
  text: z.string().min(1),
  branch: z.enum(["user", "directives", "world"]),
  topic: z.string().optional(),
  confidence: z.enum(["high", "medium", "assumption"]).optional(),
});

export function createMemoryTools(deps: {
  store: MemoryStore;
  retriever: MemoryRetriever;
  onProfileMaybeChanged?: () => void | Promise<void>;
}): ToolDefinition[] {
  return [
    {
      name: "memory_search",
      description:
        "Search long-term memory for facts about the user, directives, or world knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          branch: {
            type: "string",
            enum: ["user", "directives", "world"],
            description: "Optional memory branch filter",
          },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
      handler: async (raw) => {
        const parsed = searchSchema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const hits = await deps.retriever.search(parsed.data);
        const facts = await deps.store.getByIds(hits.map((h) => h.id));
        return {
          ok: true,
          data: {
            results: facts.map((f, i) => ({
              id: f.id,
              branch: f.branch,
              topic: f.topic,
              text: f.text,
              confidence: f.confidence,
              score: hits[i]?.score,
            })),
          },
        };
      },
    },
    {
      name: "memory_save",
      description:
        "Save a new long-term memory fact when the user asks to remember something.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Fact text to store" },
          branch: {
            type: "string",
            enum: ["user", "directives", "world"],
          },
          topic: { type: "string" },
          confidence: {
            type: "string",
            enum: ["high", "medium", "assumption"],
          },
        },
        required: ["text", "branch"],
      },
      handler: async (raw) => {
        const parsed = saveSchema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const source = "realtime:memory_save";
        const contentHash = hashFactContent(source, parsed.data.text);
        const fact = await deps.store.save({
          branch: parsed.data.branch,
          topic: parsed.data.topic ?? "",
          text: parsed.data.text,
          confidence: parsed.data.confidence ?? "high",
          source,
          contentHash,
        });
        await deps.retriever.index(fact.id);
        if (
          parsed.data.branch === "user" ||
          parsed.data.branch === "directives"
        ) {
          await deps.onProfileMaybeChanged?.();
        }
        return {
          ok: true,
          data: { id: fact.id, branch: fact.branch, text: fact.text },
        };
      },
    },
    {
      name: "get_current_time",
      description: "Get the current date and time in ISO-8601 and local string form.",
      parameters: {
        type: "object",
        properties: {
          timeZone: {
            type: "string",
            description: "IANA timezone, e.g. America/Chicago",
          },
        },
      },
      handler: async (raw) => {
        const schema = z.object({ timeZone: z.string().optional() });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const now = new Date();
        const timeZone = parsed.data.timeZone ?? "America/Chicago";
        return {
          ok: true,
          data: {
            iso: now.toISOString(),
            local: now.toLocaleString("ru-RU", { timeZone }),
            timeZone,
          },
        };
      },
    },
  ];
}
