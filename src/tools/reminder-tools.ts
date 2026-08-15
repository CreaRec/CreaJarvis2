import type { AppConfig } from "../config.js";
import type { ICloudCalendarClient } from "../calendar/icloud-client.js";
import {
  addDaysLocal,
  formatLocal,
  zonedLocalToUtc,
  zonedParts,
} from "../utils/time/index.js";
import { toPublic, type ReminderStore } from "../reminders/store.js";
import type { Recurrence } from "../reminders/types.js";
import {
  deleteLinkedCalendarEvent,
  syncCalendarAfterReminderUpdate,
} from "./calendar-tools.js";
import { logger } from "../log.js";
import { type ToolDefinition, z } from "./gateway.js";

const recurrenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("daily"),
    untilDate: z.string().optional(),
  }),
  z.object({
    kind: z.literal("weekdays"),
    untilDate: z.string().optional(),
  }),
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

function parseFireAt(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayBounds(timezone: string, now = new Date()): { start: Date; end: Date } {
  const p = zonedParts(now, timezone);
  const start = zonedLocalToUtc(timezone, p.year, p.month, p.day, 0, 0, 0);
  const end = addDaysLocal(start, timezone, 1);
  return { start, end };
}

export function createReminderTools(deps: {
  store: ReminderStore;
  config: AppConfig;
  calendarEnabled?: boolean;
  calendar?: ICloudCalendarClient | null;
}): ToolDefinition[] {
  const tz = () => deps.config.USER_TIMEZONE;
  const calendarEnabled = Boolean(deps.calendarEnabled && deps.calendar);
  const calendar = deps.calendar ?? null;

  return [
    {
      name: "reminder_create",
      description:
        "Create a reminder. Resolve relative times with get_current_time first, then pass absolute fire_at ISO-8601. Result includes fire_at_iso and fire_at_local — speak fire_at_local only. Use for «напомни…», not for long-term memory facts.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to remind about" },
          fire_at: {
            type: "string",
            description: "Absolute fire time ISO-8601",
          },
          raw_utterance: {
            type: "string",
            description: "Original user phrase",
          },
          recurrence: {
            type: "object",
            description:
              "Optional recurrence: daily | weekdays | weekly{days} | every_n_days | every_n_hours; optional untilDate YYYY-MM-DD",
          },
          location_name: {
            type: "string",
            description: "Place name from places_search (e.g. Starbucks)",
          },
          location_address: {
            type: "string",
            description: "Formatted address from places_search",
          },
          location_maps_url: {
            type: "string",
            description: "Google Maps URL from places_search (do not read aloud)",
          },
          location_lat: { type: "number", description: "Latitude" },
          location_lon: { type: "number", description: "Longitude" },
        },
        required: ["text", "fire_at"],
      },
      handler: async (raw) => {
        const schema = z.object({
          text: z.string().min(1),
          fire_at: z.string().min(1),
          raw_utterance: z.string().optional(),
          recurrence: recurrenceSchema.optional(),
          location_name: z.string().min(1).optional(),
          location_address: z.string().min(1).optional(),
          location_maps_url: z.string().url().optional(),
          location_lat: z.number().finite().optional(),
          location_lon: z.number().finite().optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const fireAt = parseFireAt(parsed.data.fire_at);
        if (!fireAt) {
          return { ok: false, error: "Invalid fire_at ISO timestamp" };
        }
        if (fireAt.getTime() <= Date.now() - 30_000) {
          return {
            ok: false,
            error: `fire_at is in the past: ${formatLocal(fireAt, tz())}`,
          };
        }
        const record = await deps.store.create({
          text: parsed.data.text,
          fireAt,
          timezone: tz(),
          rawUtterance: parsed.data.raw_utterance ?? null,
          recurrence: (parsed.data.recurrence as Recurrence | undefined) ?? null,
          locationName: parsed.data.location_name ?? null,
          locationAddress: parsed.data.location_address ?? null,
          locationMapsUrl: parsed.data.location_maps_url ?? null,
          locationLat: parsed.data.location_lat ?? null,
          locationLon: parsed.data.location_lon ?? null,
        });
        return {
          ok: true,
          data: { ...toPublic(record), offer_calendar: calendarEnabled },
        };
      },
    },
    {
      name: "reminder_list",
      description:
        "List upcoming reminders. Default: next 2 days, pending/snoozed/missed.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "ISO start (inclusive)" },
          to: { type: "string", description: "ISO end (inclusive)" },
          status: {
            type: "string",
            enum: [
              "pending",
              "snoozed",
              "missed",
              "delivered",
              "cancelled",
              "delivering",
            ],
          },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
      handler: async (raw) => {
        const schema = z.object({
          from: z.string().optional(),
          to: z.string().optional(),
          status: z
            .enum([
              "pending",
              "snoozed",
              "missed",
              "delivered",
              "cancelled",
              "delivering",
            ])
            .optional(),
          limit: z.number().int().min(1).max(50).optional(),
        });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const started = Date.now();
        const now = new Date();
        const fromDefaulted = !parsed.data.from;
        const toDefaulted = !parsed.data.to;
        const from = parsed.data.from
          ? parseFireAt(parsed.data.from)
          : now;
        const to = parsed.data.to
          ? parseFireAt(parsed.data.to)
          : new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
        if (!from || !to) {
          return { ok: false, error: "Invalid from/to ISO timestamp" };
        }
        const limit = parsed.data.limit ?? 30;
        const statuses = parsed.data.status
          ? [parsed.data.status]
          : (["pending", "snoozed", "missed"] as const);
        const rows = await deps.store.list({
          from,
          to,
          statuses: [...statuses],
          limit,
        });
        logger.info("[reminders] list", {
          component: "reminders",
          handler: "tool",
          step: "finish",
          tool: "reminder_list",
          result: "success",
          from: from.toISOString(),
          to: to.toISOString(),
          limit,
          count: rows.length,
          from_defaulted: fromDefaulted,
          to_defaulted: toDefaulted,
          status: parsed.data.status ?? "pending,snoozed,missed",
          duration_ms: Date.now() - started,
        });
        return {
          ok: true,
          data: { reminders: rows.map(toPublic), count: rows.length },
        };
      },
    },
    {
      name: "reminder_search",
      description:
        "Search reminders by topic/text (e.g. «что я просил напомнить про врача»).",
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
        const rows = await deps.store.search(
          parsed.data.query,
          parsed.data.limit ?? 10,
        );
        return {
          ok: true,
          data: { reminders: rows.map(toPublic), count: rows.length },
        };
      },
    },
    {
      name: "reminder_update",
      description:
        "Update reminder text, fire_at, recurrence, and/or location by id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          fire_at: { type: "string" },
          recurrence: { type: "object" },
          location_name: { type: "string" },
          location_address: { type: "string" },
          location_maps_url: { type: "string" },
          location_lat: { type: "number" },
          location_lon: { type: "number" },
        },
        required: ["id"],
      },
      handler: async (raw) => {
        const schema = z.object({
          id: z.string().uuid(),
          text: z.string().min(1).optional(),
          fire_at: z.string().optional(),
          recurrence: recurrenceSchema.nullable().optional(),
          location_name: z.string().min(1).nullable().optional(),
          location_address: z.string().min(1).nullable().optional(),
          location_maps_url: z.string().url().nullable().optional(),
          location_lat: z.number().finite().nullable().optional(),
          location_lon: z.number().finite().nullable().optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const before = await deps.store.getById(parsed.data.id);
        if (!before) {
          return { ok: false, error: "Reminder not found" };
        }
        let fireAt: Date | undefined;
        if (parsed.data.fire_at) {
          const d = parseFireAt(parsed.data.fire_at);
          if (!d) return { ok: false, error: "Invalid fire_at" };
          fireAt = d;
        }
        const updated = await deps.store.update(parsed.data.id, {
          text: parsed.data.text,
          fireAt,
          recurrence:
            parsed.data.recurrence === undefined
              ? undefined
              : ((parsed.data.recurrence as Recurrence | null) ?? null),
          locationName:
            parsed.data.location_name === undefined
              ? undefined
              : parsed.data.location_name,
          locationAddress:
            parsed.data.location_address === undefined
              ? undefined
              : parsed.data.location_address,
          locationMapsUrl:
            parsed.data.location_maps_url === undefined
              ? undefined
              : parsed.data.location_maps_url,
          locationLat:
            parsed.data.location_lat === undefined
              ? undefined
              : parsed.data.location_lat,
          locationLon:
            parsed.data.location_lon === undefined
              ? undefined
              : parsed.data.location_lon,
          status: fireAt ? "pending" : undefined,
        });
        if (!updated) {
          return { ok: false, error: "Reminder not found" };
        }
        const locationChanged =
          parsed.data.location_name !== undefined ||
          parsed.data.location_address !== undefined ||
          parsed.data.location_maps_url !== undefined ||
          parsed.data.location_lat !== undefined ||
          parsed.data.location_lon !== undefined;
        if (
          calendar &&
          (parsed.data.text !== undefined || fireAt || locationChanged)
        ) {
          const sync = await syncCalendarAfterReminderUpdate({
            calendar,
            store: deps.store,
            before,
            after: updated,
            timeZone: tz(),
          });
          if (!sync.ok) {
            await deps.store.update(before.id, {
              text: before.text,
              fireAt: before.fireAt,
              status: before.status,
              recurrence: before.recurrence,
              calendarEndAt: before.calendarEndAt,
              locationName: before.locationName,
              locationAddress: before.locationAddress,
              locationMapsUrl: before.locationMapsUrl,
              locationLat: before.locationLat,
              locationLon: before.locationLon,
            });
            return { ok: false, error: sync.error };
          }
          const refreshed = await deps.store.getById(updated.id);
          return {
            ok: true,
            data: toPublic(refreshed ?? updated),
          };
        }
        return { ok: true, data: toPublic(updated) };
      },
    },
    {
      name: "reminder_cancel",
      description:
        "Cancel one reminder by id, or by query. If query matches multiple, returns candidates without cancelling.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          query: { type: "string" },
        },
      },
      handler: async (raw) => {
        const schema = z
          .object({
            id: z.string().uuid().optional(),
            query: z.string().min(1).optional(),
          })
          .refine((v) => Boolean(v.id || v.query), {
            message: "Provide id or query",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }

        const cancelOne = async (id: string) => {
          const current = await deps.store.getById(id);
          if (!current) {
            return { ok: false as const, error: "Reminder not found" };
          }
          let calendarDeleteError: string | undefined;
          if (calendar && current.calendarHref) {
            const del = await deleteLinkedCalendarEvent({
              calendar,
              store: deps.store,
              reminder: current,
            });
            if (!del.deleted && del.error) {
              calendarDeleteError = del.error;
            }
          }
          const cancelled = await deps.store.cancel(id);
          if (!cancelled) {
            return { ok: false as const, error: "Reminder not found" };
          }
          return {
            ok: true as const,
            data: {
              ...toPublic(cancelled),
              ...(calendarDeleteError
                ? { calendar_delete_error: calendarDeleteError }
                : {}),
            },
          };
        };

        if (parsed.data.id) {
          return cancelOne(parsed.data.id);
        }
        const hits = await deps.store.search(parsed.data.query!, 10);
        if (hits.length === 0) {
          return { ok: false, error: "No matching reminders" };
        }
        if (hits.length > 1) {
          return {
            ok: true,
            data: {
              need_clarification: true,
              candidates: hits.map(toPublic),
            },
          };
        }
        return cancelOne(hits[0]!.id);
      },
    },
    {
      name: "reminder_snooze",
      description:
        "Snooze a reminder to a new time (until_fire_at ISO or minutes from now). Short snooze can skip quiet hours.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          until_fire_at: { type: "string" },
          minutes: { type: "integer", minimum: 1 },
          skip_quiet_hours: { type: "boolean" },
        },
        required: ["id"],
      },
      handler: async (raw) => {
        const schema = z
          .object({
            id: z.string().uuid(),
            until_fire_at: z.string().optional(),
            minutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
            skip_quiet_hours: z.boolean().optional(),
          })
          .refine((v) => Boolean(v.until_fire_at || v.minutes), {
            message: "Provide until_fire_at or minutes",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        let fireAt: Date;
        if (parsed.data.until_fire_at) {
          const d = parseFireAt(parsed.data.until_fire_at);
          if (!d) return { ok: false, error: "Invalid until_fire_at" };
          fireAt = d;
        } else {
          fireAt = new Date(Date.now() + parsed.data.minutes! * 60_000);
        }
        const skip =
          parsed.data.skip_quiet_hours === true ||
          (parsed.data.minutes !== undefined && parsed.data.minutes <= 60);
        const updated = await deps.store.update(parsed.data.id, {
          fireAt,
          status: "snoozed",
          quietHoursOverride: skip ? true : null,
        });
        if (!updated) {
          return { ok: false, error: "Reminder not found" };
        }
        return { ok: true, data: toPublic(updated) };
      },
    },
    {
      name: "reminder_cancel_many",
      description:
        "Cancel many reminders: today, all_pending, or a fire_at range.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["today", "all_pending", "range"],
          },
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["scope"],
      },
      handler: async (raw) => {
        const schema = z.object({
          scope: z.enum(["today", "all_pending", "range"]),
          from: z.string().optional(),
          to: z.string().optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const timezone = tz();

        if (parsed.data.scope === "today") {
          const { start, end } = todayBounds(timezone);
          const opts = {
            scope: "today" as const,
            todayStart: start,
            todayEnd: end,
          };
          let calendar_delete_errors = 0;
          if (calendar) {
            const targets = await deps.store.listForCancelMany(opts);
            for (const rem of targets) {
              if (!rem.calendarHref) continue;
              const del = await deleteLinkedCalendarEvent({
                calendar,
                store: deps.store,
                reminder: rem,
              });
              if (!del.deleted && del.error) calendar_delete_errors += 1;
            }
          }
          const count = await deps.store.cancelMany(opts);
          return {
            ok: true,
            data: {
              cancelled: count,
              ...(calendar_delete_errors > 0
                ? { calendar_delete_errors }
                : {}),
            },
          };
        }
        if (parsed.data.scope === "range") {
          const from = parsed.data.from
            ? parseFireAt(parsed.data.from)
            : undefined;
          const to = parsed.data.to ? parseFireAt(parsed.data.to) : undefined;
          if (parsed.data.from && !from) {
            return { ok: false, error: "Invalid from" };
          }
          if (parsed.data.to && !to) {
            return { ok: false, error: "Invalid to" };
          }
          const opts = {
            scope: "range" as const,
            from: from ?? undefined,
            to: to ?? undefined,
          };
          let calendar_delete_errors = 0;
          if (calendar) {
            const targets = await deps.store.listForCancelMany(opts);
            for (const rem of targets) {
              if (!rem.calendarHref) continue;
              const del = await deleteLinkedCalendarEvent({
                calendar,
                store: deps.store,
                reminder: rem,
              });
              if (!del.deleted && del.error) calendar_delete_errors += 1;
            }
          }
          const count = await deps.store.cancelMany(opts);
          return {
            ok: true,
            data: {
              cancelled: count,
              ...(calendar_delete_errors > 0
                ? { calendar_delete_errors }
                : {}),
            },
          };
        }
        const opts = { scope: "all_pending" as const };
        let calendar_delete_errors = 0;
        if (calendar) {
          const targets = await deps.store.listForCancelMany(opts);
          for (const rem of targets) {
            if (!rem.calendarHref) continue;
            const del = await deleteLinkedCalendarEvent({
              calendar,
              store: deps.store,
              reminder: rem,
            });
            if (!del.deleted && del.error) calendar_delete_errors += 1;
          }
        }
        const count = await deps.store.cancelMany(opts);
        return {
          ok: true,
          data: {
            cancelled: count,
            ...(calendar_delete_errors > 0
              ? { calendar_delete_errors }
              : {}),
          },
        };
      },
    },
  ];
}
