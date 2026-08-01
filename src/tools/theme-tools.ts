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

const kindSchema = z.enum(["idea", "project", "trip"]);
const statusSchema = z.enum(["active", "on_hold", "done", "archived"]);
const entryKindSchema = z.enum([
  "note",
  "question",
  "decision",
  "checklist",
  "link",
]);
const entryStatusSchema = z.enum(["open", "done", "cancelled"]);

export function createThemeTools(deps: {
  store: ThemeStore;
}): ToolDefinition[] {
  return [
    {
      name: "theme_create",
      description:
        "Create an idea, project, or trip theme. Keep title/first_entry wording faithful to the user.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["idea", "project", "trip"] },
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
        const theme = await deps.store.create({
          kind: parsed.data.kind,
          title: parsed.data.title,
          summary: parsed.data.summary ?? null,
          meta: parsed.data.meta ?? null,
          rawUtterance: parsed.data.raw_utterance ?? null,
          firstEntry: parsed.data.first_entry
            ? {
                text: parsed.data.first_entry.text,
                kind: parsed.data.first_entry.kind,
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
        "List themes (ideas/projects/trips). Default: active, newest touched first.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["idea", "project", "trip"] },
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
        "Get one theme by id, or by query. If query matches multiple, returns candidates without picking.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          query: { type: "string" },
          kind: { type: "string", enum: ["idea", "project", "trip"] },
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
      description: "Search themes and their entries by topic/text.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: { type: "string", enum: ["idea", "project", "trip"] },
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
        "Add a note/question/decision/checklist/link to a theme (by theme_id or query).",
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

        let themeId = parsed.data.theme_id;
        if (!themeId) {
          const hits = await deps.store.search(parsed.data.query!, {
            limit: 5,
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
          themeId = hits[0]!.id;
        }

        const theme = await deps.store.addEntry({
          themeId,
          text: parsed.data.text,
          kind: parsed.data.kind as ThemeEntryKind | undefined,
          rawUtterance: parsed.data.raw_utterance ?? null,
        });
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
          kind: { type: "string", enum: ["idea", "project", "trip"] },
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
