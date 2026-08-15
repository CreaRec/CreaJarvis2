import {
  toThemePublic,
  type ThemeStore,
} from "../themes/store.js";
import type {
  ThemeEntryKind,
  ThemeKind,
  ThemeStatus,
} from "../themes/types.js";
import { type ToolDefinition, z } from "./gateway.js";

const THEME_KINDS = ["idea", "project", "trip", "list"] as const;
const kindSchema = z.enum(THEME_KINDS);
const statusSchema = z.enum(["active", "on_hold", "done", "archived"]);
const entryKindSchema = z.enum([
  "note",
  "question",
  "decision",
  "checklist",
  "link",
]);
const entryStatusSchema = z.enum(["open", "done", "cancelled"]);

async function resolveThemeId(
  store: ThemeStore,
  opts: { theme_id?: string; query?: string; kind?: ThemeKind },
): Promise<
  | { ok: true; themeId: string }
  | { ok: false; error: string }
  | {
      ok: true;
      clarification: { need_clarification: true; candidates: unknown[] };
    }
> {
  if (opts.theme_id) return { ok: true, themeId: opts.theme_id };
  const hits = await store.search(opts.query!, {
    kind: opts.kind,
    limit: 5,
  });
  if (hits.length === 0) return { ok: false, error: "No matching themes" };
  if (hits.length > 1) {
    return {
      ok: true,
      clarification: {
        need_clarification: true,
        candidates: hits.map(toThemePublic),
      },
    };
  }
  return { ok: true, themeId: hits[0]!.id };
}

export function createThemeTools(deps: {
  store: ThemeStore;
}): ToolDefinition[] {
  return [
    {
      name: "theme_create",
      description:
        "Create an idea, project, trip, or list theme. For shopping/bucket lists use kind=list with checklist entries. Keep title/first_entry wording faithful to the user.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...THEME_KINDS] },
          title: { type: "string" },
          summary: { type: "string" },
          meta: {
            type: "object",
            description:
              "Structured fields, e.g. trip: destination/startDate/endDate/budget/companions",
          },
          raw_utterance: { type: "string" },
          first_entry: {
            type: "object",
            properties: {
              text: { type: "string" },
              kind: {
                type: "string",
                enum: ["note", "question", "decision", "checklist", "link"],
              },
              raw_utterance: { type: "string" },
            },
            required: ["text"],
          },
        },
        required: ["kind", "title"],
      },
      handler: async (raw) => {
        const schema = z.object({
          kind: kindSchema,
          title: z.string().min(1),
          summary: z.string().optional(),
          meta: z.record(z.unknown()).optional(),
          raw_utterance: z.string().optional(),
          first_entry: z
            .object({
              text: z.string().min(1),
              kind: entryKindSchema.optional(),
              raw_utterance: z.string().optional(),
            })
            .optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const firstKind =
          parsed.data.first_entry?.kind ??
          (parsed.data.kind === "list" ? "checklist" : undefined);
        const theme = await deps.store.create({
          kind: parsed.data.kind,
          title: parsed.data.title,
          summary: parsed.data.summary ?? null,
          meta: parsed.data.meta ?? null,
          rawUtterance: parsed.data.raw_utterance ?? null,
          firstEntry: parsed.data.first_entry
            ? {
                text: parsed.data.first_entry.text,
                kind: firstKind,
                rawUtterance: parsed.data.first_entry.raw_utterance ?? null,
              }
            : null,
        });
        return { ok: true, data: toThemePublic(theme) };
      },
    },
    {
      name: "theme_list",
      description:
        "List themes (ideas/projects/trips/lists). Use for «какие поездки», upcoming travel, active projects/ideas/lists. Prefer kind=trip for trip questions. Default: active, newest touched first. Do NOT use memory_search for trip/project notebooks.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...THEME_KINDS] },
          status: {
            type: "string",
            enum: ["active", "on_hold", "done", "archived"],
          },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
      handler: async (raw) => {
        const schema = z.object({
          kind: kindSchema.optional(),
          status: statusSchema.optional(),
          limit: z.number().int().min(1).max(50).optional(),
        });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const themes = await deps.store.list({
          kind: parsed.data.kind,
          status: parsed.data.status,
          limit: parsed.data.limit,
        });
        return {
          ok: true,
          data: {
            themes: themes.map(toThemePublic),
            count: themes.length,
          },
        };
      },
    },
    {
      name: "theme_get",
      description:
        "Get one theme by id, or by query (e.g. «Майами», trip title). Use for trip dates, packing, project status, idea details. If query matches multiple, returns candidates without picking. Prefer over memory_search for notebooks.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          query: { type: "string" },
          kind: { type: "string", enum: [...THEME_KINDS] },
        },
      },
      handler: async (raw) => {
        const schema = z
          .object({
            id: z.string().uuid().optional(),
            query: z.string().min(1).optional(),
            kind: kindSchema.optional(),
          })
          .refine((v) => Boolean(v.id || v.query), {
            message: "Provide id or query",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        if (parsed.data.id) {
          const theme = await deps.store.getById(parsed.data.id);
          if (!theme) return { ok: false, error: "Theme not found" };
          return { ok: true, data: toThemePublic(theme) };
        }
        const hits = await deps.store.search(parsed.data.query!, {
          kind: parsed.data.kind,
          limit: 8,
        });
        if (hits.length === 0) {
          return { ok: false, error: "No matching themes" };
        }
        if (hits.length > 1) {
          return {
            ok: true,
            data: {
              need_clarification: true,
              candidates: hits.map(toThemePublic),
            },
          };
        }
        return { ok: true, data: toThemePublic(hits[0]!) };
      },
    },
    {
      name: "theme_search",
      description:
        "Search themes and their entries by topic/text. Use for «поездка в X», trip dates/plans, packing, project/idea notes — e.g. query «Майами» with kind=trip. Do NOT use memory_search for these notebooks.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: { type: "string", enum: [...THEME_KINDS] },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
      handler: async (raw) => {
        const schema = z.object({
          query: z.string().min(1),
          kind: kindSchema.optional(),
          limit: z.number().int().min(1).max(20).optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const themes = await deps.store.search(parsed.data.query, {
          kind: parsed.data.kind,
          limit: parsed.data.limit,
        });
        return {
          ok: true,
          data: {
            themes: themes.map(toThemePublic),
            count: themes.length,
          },
        };
      },
    },
    {
      name: "theme_add_entry",
      description:
        "Add a single note/question/decision/checklist/link to a theme (by theme_id or query). Prefer theme_add_entries for multiple items. Use kind=note for ticket/booking fields from screenshots (carrier, flight number, PNR, route, times).",
      parameters: {
        type: "object",
        properties: {
          theme_id: { type: "string" },
          query: { type: "string" },
          text: { type: "string" },
          kind: {
            type: "string",
            enum: ["note", "question", "decision", "checklist", "link"],
          },
          raw_utterance: { type: "string" },
        },
        required: ["text"],
      },
      handler: async (raw) => {
        const schema = z
          .object({
            theme_id: z.string().uuid().optional(),
            query: z.string().min(1).optional(),
            text: z.string().min(1),
            kind: entryKindSchema.optional(),
            raw_utterance: z.string().optional(),
          })
          .refine((v) => Boolean(v.theme_id || v.query), {
            message: "Provide theme_id or query",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }

        const resolved = await resolveThemeId(deps.store, {
          theme_id: parsed.data.theme_id,
          query: parsed.data.query,
        });
        if (!resolved.ok) return resolved;
        if ("clarification" in resolved) {
          return { ok: true, data: resolved.clarification };
        }

        const theme = await deps.store.addEntry({
          themeId: resolved.themeId,
          text: parsed.data.text,
          kind: parsed.data.kind as ThemeEntryKind | undefined,
          rawUtterance: parsed.data.raw_utterance ?? null,
        });
        if (!theme) return { ok: false, error: "Theme not found" };
        return { ok: true, data: toThemePublic(theme) };
      },
    },
    {
      name: "theme_add_entries",
      description:
        "Add multiple entries to a theme in one call (shopping lists, packing, or booking details from screenshots). Default item kind is checklist when omitted — for tickets/reservations set each item kind=note and include exact carrier, flight/train numbers, PNR, routes, and times.",
      parameters: {
        type: "object",
        properties: {
          theme_id: { type: "string" },
          query: { type: "string" },
          kind: {
            type: "string",
            enum: [...THEME_KINDS],
            description: "Optional filter when resolving by query",
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                kind: {
                  type: "string",
                  enum: [
                    "note",
                    "question",
                    "decision",
                    "checklist",
                    "link",
                  ],
                },
                raw_utterance: { type: "string" },
              },
              required: ["text"],
            },
          },
        },
        required: ["items"],
      },
      handler: async (raw) => {
        const schema = z
          .object({
            theme_id: z.string().uuid().optional(),
            query: z.string().min(1).optional(),
            kind: kindSchema.optional(),
            items: z
              .array(
                z.object({
                  text: z.string().min(1),
                  kind: entryKindSchema.optional(),
                  raw_utterance: z.string().optional(),
                }),
              )
              .min(1)
              .max(50),
          })
          .refine((v) => Boolean(v.theme_id || v.query), {
            message: "Provide theme_id or query",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }

        const resolved = await resolveThemeId(deps.store, {
          theme_id: parsed.data.theme_id,
          query: parsed.data.query,
          kind: parsed.data.kind,
        });
        if (!resolved.ok) return resolved;
        if ("clarification" in resolved) {
          return { ok: true, data: resolved.clarification };
        }

        const theme = await deps.store.addEntries(
          resolved.themeId,
          parsed.data.items.map((item) => ({
            text: item.text,
            kind: item.kind ?? "checklist",
            rawUtterance: item.raw_utterance ?? null,
          })),
        );
        if (!theme) return { ok: false, error: "Theme not found" };
        return { ok: true, data: toThemePublic(theme) };
      },
    },
    {
      name: "theme_update",
      description: "Update theme title, summary, status, meta, or kind.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string", nullable: true },
          status: {
            type: "string",
            enum: ["active", "on_hold", "done", "archived"],
          },
          meta: { type: "object", nullable: true },
          kind: { type: "string", enum: [...THEME_KINDS] },
        },
        required: ["id"],
      },
      handler: async (raw) => {
        const schema = z.object({
          id: z.string().uuid(),
          title: z.string().min(1).optional(),
          summary: z.string().nullable().optional(),
          status: statusSchema.optional(),
          meta: z.record(z.unknown()).nullable().optional(),
          kind: kindSchema.optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const theme = await deps.store.updateTheme(parsed.data.id, {
          title: parsed.data.title,
          summary: parsed.data.summary,
          status: parsed.data.status as ThemeStatus | undefined,
          meta: parsed.data.meta,
          kind: parsed.data.kind as ThemeKind | undefined,
        });
        if (!theme) return { ok: false, error: "Theme not found" };
        return { ok: true, data: toThemePublic(theme) };
      },
    },
    {
      name: "theme_update_entry",
      description: "Update a theme entry text, status, or kind.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          status: { type: "string", enum: ["open", "done", "cancelled"] },
          kind: {
            type: "string",
            enum: ["note", "question", "decision", "checklist", "link"],
          },
        },
        required: ["id"],
      },
      handler: async (raw) => {
        const schema = z.object({
          id: z.string().uuid(),
          text: z.string().min(1).optional(),
          status: entryStatusSchema.optional(),
          kind: entryKindSchema.optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const entry = await deps.store.updateEntry(parsed.data.id, {
          text: parsed.data.text,
          status: parsed.data.status,
          kind: parsed.data.kind,
        });
        if (!entry) return { ok: false, error: "Entry not found" };
        return {
          ok: true,
          data: {
            id: entry.id,
            theme_id: entry.themeId,
            kind: entry.kind,
            status: entry.status,
            text: entry.text,
          },
        };
      },
    },
    {
      name: "theme_promote",
      description: "Promote an idea theme to a project (optionally rename).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
        },
        required: ["id"],
      },
      handler: async (raw) => {
        const schema = z.object({
          id: z.string().uuid(),
          title: z.string().min(1).optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const theme = await deps.store.promote(
          parsed.data.id,
          parsed.data.title,
        );
        if (!theme) return { ok: false, error: "Theme not found" };
        return { ok: true, data: toThemePublic(theme) };
      },
    },
    {
      name: "theme_archive",
      description: "Archive a theme (status=archived).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      handler: async (raw) => {
        const schema = z.object({ id: z.string().uuid() });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const theme = await deps.store.archive(parsed.data.id);
        if (!theme) return { ok: false, error: "Theme not found" };
        return { ok: true, data: toThemePublic(theme) };
      },
    },
  ];
}
