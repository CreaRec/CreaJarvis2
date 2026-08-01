import type { AppConfig } from "../config.js";
import {
  addLocalDateDays,
  isValidLocalDate,
  todayLocalDate,
} from "../utils/time/index.js";
import {
  toDayPublic,
  toItemPublic,
  type PlanStore,
} from "../plans/store.js";
import type { Recurrence } from "../reminders/types.js";
import { type ToolDefinition, z } from "./gateway.js";

const recurrenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), untilDate: z.string().optional() }),
  z.object({ kind: z.literal("weekdays"), untilDate: z.string().optional() }),
  z.object({
    kind: z.literal("weekly"),
    days: z.array(z.number().int().min(1).max(7)).min(1),
    untilDate: z.string().optional(),
  }),
  z.object({
    kind: z.literal("every_n_days"),
    n: z.number().int().min(1),
    untilDate: z.string().optional(),
  }),
  z.object({
    kind: z.literal("every_n_hours"),
    n: z.number().int().min(1),
    untilDate: z.string().optional(),
  }),
]);

const itemInputSchema = z.object({
  text: z.string().min(1),
  scheduled_at: z.string().optional(),
  remind: z.boolean().optional(),
  recurrence: recurrenceSchema.optional(),
  raw_utterance: z.string().optional(),
});

function parseIso(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveDate(
  raw: string | undefined,
  timezone: string,
  now: Date,
): string | { error: string } {
  if (!raw) return todayLocalDate(timezone, now);
  if (!isValidLocalDate(raw)) return { error: `Invalid date: ${raw}` };
  return raw;
}

export function createPlanTools(deps: {
  store: PlanStore;
  config: AppConfig;
}): ToolDefinition[] {
  const tz = () => deps.config.USER_TIMEZONE;

  return [
    {
      name: "plan_set",
      description:
        "Replace the day plan for a local YYYY-MM-DD. Default date=today (never tomorrow unless the user said tomorrow). Item text: keep the user's wording; raw_utterance=original user phrase. scheduled_at items get a linked reminder.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "YYYY-MM-DD local. Omit for today. «сегодня» → today only; «завтра» → tomorrow.",
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: {
                  type: "string",
                  description:
                    "Plan item text; preserve user's words (do not paraphrase).",
                },
                scheduled_at: { type: "string" },
                remind: { type: "boolean" },
                recurrence: { type: "object" },
                raw_utterance: {
                  type: "string",
                  description: "Exact user utterance for this item",
                },
              },
              required: ["text"],
            },
          },
        },
        required: ["items"],
      },
      handler: async (raw) => {
        const schema = z.object({
          date: z.string().optional(),
          items: z.array(itemInputSchema).min(1),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const now = new Date();
        const date = resolveDate(parsed.data.date, tz(), now);
        if (typeof date === "object") return { ok: false, error: date.error };

        const inputs = [];
        for (const item of parsed.data.items) {
          let scheduledAt: Date | null = null;
          if (item.scheduled_at) {
            scheduledAt = parseIso(item.scheduled_at);
            if (!scheduledAt) {
              return { ok: false, error: `Invalid scheduled_at: ${item.scheduled_at}` };
            }
            if (scheduledAt.getTime() <= now.getTime() - 30_000) {
              return {
                ok: false,
                error: `scheduled_at is in the past: ${item.scheduled_at}`,
              };
            }
          }
          inputs.push({
            text: item.text,
            scheduledAt,
            remind: item.remind,
            recurrence: (item.recurrence as Recurrence | undefined) ?? null,
            rawUtterance: item.raw_utterance ?? null,
          });
        }
        const plan = await deps.store.setDay(date, inputs);
        return { ok: true, data: toDayPublic(plan) };
      },
    },
    {
      name: "plan_add",
      description:
        "Add items to a day plan. «на сегодня/вечером» → omit date or pass today's YYYY-MM-DD (not tomorrow). Keep item text faithful to the user; raw_utterance=original phrase. Timed items create linked reminders.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "YYYY-MM-DD local. Omit for today. Never use tomorrow for «сегодня».",
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: {
                  type: "string",
                  description:
                    "Preserve user's wording (e.g. «свадьба у Вити», not a rewrite).",
                },
                scheduled_at: { type: "string" },
                remind: { type: "boolean" },
                recurrence: { type: "object" },
                raw_utterance: {
                  type: "string",
                  description: "Exact user utterance",
                },
              },
              required: ["text"],
            },
          },
        },
        required: ["items"],
      },
      handler: async (raw) => {
        const schema = z.object({
          date: z.string().optional(),
          items: z.array(itemInputSchema).min(1),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const now = new Date();
        const date = resolveDate(parsed.data.date, tz(), now);
        if (typeof date === "object") return { ok: false, error: date.error };

        const inputs = [];
        for (const item of parsed.data.items) {
          let scheduledAt: Date | null = null;
          if (item.scheduled_at) {
            scheduledAt = parseIso(item.scheduled_at);
            if (!scheduledAt) {
              return { ok: false, error: `Invalid scheduled_at: ${item.scheduled_at}` };
            }
            if (scheduledAt.getTime() <= now.getTime() - 30_000) {
              return {
                ok: false,
                error: `scheduled_at is in the past: ${item.scheduled_at}`,
              };
            }
          }
          inputs.push({
            text: item.text,
            scheduledAt,
            remind: item.remind,
            recurrence: (item.recurrence as Recurrence | undefined) ?? null,
            rawUtterance: item.raw_utterance ?? null,
          });
        }
        const plan = await deps.store.addItems(date, inputs);
        return { ok: true, data: toDayPublic(plan) };
      },
    },
    {
      name: "plan_get",
      description:
        "Get day plan(s). «что сегодня / планы на сегодня» → omit date or pass TODAY from get_current_time — never tomorrow. «завтра» → tomorrow's YYYY-MM-DD. from+to for a range. Report the returned `date` and item texts as-is.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "YYYY-MM-DD. Omit for today. Do not pass tomorrow unless the user said tomorrow.",
          },
          from: { type: "string" },
          to: { type: "string" },
        },
      },
      handler: async (raw) => {
        const schema = z.object({
          date: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const now = new Date();
        if (parsed.data.from || parsed.data.to) {
          const from = resolveDate(
            parsed.data.from,
            tz(),
            now,
          );
          const to = resolveDate(parsed.data.to ?? parsed.data.from, tz(), now);
          if (typeof from === "object") return { ok: false, error: from.error };
          if (typeof to === "object") return { ok: false, error: to.error };
          const plans = await deps.store.listRange(from, to);
          return {
            ok: true,
            data: { plans: plans.map(toDayPublic) },
          };
        }
        const date = resolveDate(parsed.data.date, tz(), now);
        if (typeof date === "object") return { ok: false, error: date.error };
        const plan = await deps.store.getOrEmpty(date);
        return { ok: true, data: toDayPublic(plan) };
      },
    },
    {
      name: "plan_search",
      description: "Search plan items by topic/text.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
      handler: async (raw) => {
        const schema = z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(20).optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const items = await deps.store.search(
          parsed.data.query,
          parsed.data.limit ?? 10,
        );
        return {
          ok: true,
          data: {
            items: items.map((i) => ({
              ...toItemPublic(i),
              date: i.localDate,
            })),
            count: items.length,
          },
        };
      },
    },
    {
      name: "plan_update_item",
      description: "Update a plan item by id (text, scheduled_at, status, sort_order).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          scheduled_at: { type: "string", nullable: true },
          status: { type: "string", enum: ["open", "done", "cancelled"] },
          sort_order: { type: "integer" },
          recurrence: { type: "object", nullable: true },
        },
        required: ["id"],
      },
      handler: async (raw) => {
        const schema = z.object({
          id: z.string().uuid(),
          text: z.string().min(1).optional(),
          scheduled_at: z.string().nullable().optional(),
          status: z.enum(["open", "done", "cancelled"]).optional(),
          sort_order: z.number().int().optional(),
          recurrence: recurrenceSchema.nullable().optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        let scheduledAt: Date | null | undefined;
        if (parsed.data.scheduled_at === null) scheduledAt = null;
        else if (parsed.data.scheduled_at) {
          const d = parseIso(parsed.data.scheduled_at);
          if (!d) return { ok: false, error: "Invalid scheduled_at" };
          if (d.getTime() <= Date.now() - 30_000) {
            return { ok: false, error: "scheduled_at is in the past" };
          }
          scheduledAt = d;
        }
        const updated = await deps.store.updateItem(parsed.data.id, {
          text: parsed.data.text,
          scheduledAt,
          status: parsed.data.status,
          sortOrder: parsed.data.sort_order,
          recurrence:
            parsed.data.recurrence === undefined
              ? undefined
              : ((parsed.data.recurrence as Recurrence | null) ?? null),
        });
        if (!updated) return { ok: false, error: "Plan item not found" };
        return {
          ok: true,
          data: { ...toItemPublic(updated), date: updated.localDate },
        };
      },
    },
    {
      name: "plan_complete_item",
      description: "Mark a plan item done (cancels linked reminder; advances recurrence).",
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
        const updated = await deps.store.completeItem(parsed.data.id);
        if (!updated) return { ok: false, error: "Plan item not found" };
        return {
          ok: true,
          data: { ...toItemPublic(updated), date: updated.localDate },
        };
      },
    },
    {
      name: "plan_cancel_item",
      description: "Cancel a plan item and its linked reminder.",
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
        const updated = await deps.store.cancelItem(parsed.data.id);
        if (!updated) return { ok: false, error: "Plan item not found" };
        return {
          ok: true,
          data: { ...toItemPublic(updated), date: updated.localDate },
        };
      },
    },
    {
      name: "plan_move_item",
      description: "Move a plan item to another local date (YYYY-MM-DD).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          to_date: { type: "string" },
          scheduled_at: { type: "string" },
        },
        required: ["id", "to_date"],
      },
      handler: async (raw) => {
        const schema = z.object({
          id: z.string().uuid(),
          to_date: z.string(),
          scheduled_at: z.string().optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        if (!isValidLocalDate(parsed.data.to_date)) {
          return { ok: false, error: `Invalid to_date: ${parsed.data.to_date}` };
        }
        let scheduledAt: Date | undefined;
        if (parsed.data.scheduled_at) {
          const d = parseIso(parsed.data.scheduled_at);
          if (!d) return { ok: false, error: "Invalid scheduled_at" };
          scheduledAt = d;
        }
        const updated = await deps.store.moveItem(
          parsed.data.id,
          parsed.data.to_date,
          scheduledAt,
        );
        if (!updated) return { ok: false, error: "Plan item not found" };
        return {
          ok: true,
          data: { ...toItemPublic(updated), date: updated.localDate },
        };
      },
    },
    {
      name: "plan_carry_over",
      description:
        "Move all open items from from_date to to_date. Defaults: from=today, to=tomorrow.",
      parameters: {
        type: "object",
        properties: {
          from_date: { type: "string" },
          to_date: { type: "string" },
        },
      },
      handler: async (raw) => {
        const schema = z.object({
          from_date: z.string().optional(),
          to_date: z.string().optional(),
        });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const now = new Date();
        const from =
          parsed.data.from_date ?? todayLocalDate(tz(), now);
        const to =
          parsed.data.to_date ?? addLocalDateDays(from, tz(), 1);
        if (!isValidLocalDate(from)) {
          return { ok: false, error: `Invalid from_date: ${from}` };
        }
        if (!isValidLocalDate(to)) {
          return { ok: false, error: `Invalid to_date: ${to}` };
        }
        const plan = await deps.store.carryOver(from, to);
        return {
          ok: true,
          data: { from_date: from, to_date: to, ...toDayPublic(plan) },
        };
      },
    },
    {
      name: "plan_clear",
      description: "Cancel plan items for a date (default only open).",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string" },
          only_open: { type: "boolean" },
        },
      },
      handler: async (raw) => {
        const schema = z.object({
          date: z.string().optional(),
          only_open: z.boolean().optional(),
        });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const date = resolveDate(parsed.data.date, tz(), new Date());
        if (typeof date === "object") return { ok: false, error: date.error };
        const plan = await deps.store.clearDay(
          date,
          parsed.data.only_open ?? true,
        );
        return { ok: true, data: toDayPublic(plan) };
      },
    },
  ];
}
