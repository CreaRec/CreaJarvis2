import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { ICloudCalendarClient } from "../calendar/icloud-client.js";
import { formatLocal } from "../utils/time/index.js";
import { toPublic, type ReminderStore } from "../reminders/store.js";
import type { ReminderRecord } from "../reminders/types.js";
import { type ToolDefinition, z } from "./gateway.js";

function parseIso(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventDurationMs(reminder: ReminderRecord): number {
  if (reminder.calendarEndAt) {
    const ms = reminder.calendarEndAt.getTime() - reminder.fireAt.getTime();
    if (ms > 0) return ms;
  }
  return 30 * 60 * 1000;
}

export async function deleteLinkedCalendarEvent(opts: {
  calendar: ICloudCalendarClient;
  store: ReminderStore;
  reminder: ReminderRecord;
}): Promise<{ deleted: boolean; error?: string }> {
  if (!opts.reminder.calendarHref) {
    return { deleted: false };
  }
  const result = await opts.calendar.deleteEvent(opts.reminder.calendarHref);
  if (!result.ok) {
    return { deleted: false, error: result.error };
  }
  await opts.store.clearCalendarLink(opts.reminder.id);
  return { deleted: true };
}

export async function syncCalendarAfterReminderUpdate(opts: {
  calendar: ICloudCalendarClient;
  store: ReminderStore;
  before: ReminderRecord;
  after: ReminderRecord;
  timeZone: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!opts.before.calendarHref || !opts.before.calendarUid) {
    return { ok: true };
  }
  const textChanged = opts.before.text !== opts.after.text;
  const timeChanged =
    opts.before.fireAt.getTime() !== opts.after.fireAt.getTime();
  if (!textChanged && !timeChanged) {
    return { ok: true };
  }
  const duration = eventDurationMs(opts.before);
  const end = new Date(opts.after.fireAt.getTime() + duration);
  const updated = await opts.calendar.updateEvent(opts.before.calendarHref, {
    uid: opts.before.calendarUid,
    title: opts.after.text,
    start: opts.after.fireAt,
    end,
    timeZone: opts.timeZone,
  });
  if (!updated.ok) {
    return { ok: false, error: updated.error };
  }
  await opts.store.update(opts.after.id, { calendarEndAt: end });
  return { ok: true };
}

export function createCalendarTools(deps: {
  calendar: ICloudCalendarClient;
  store: ReminderStore;
  config: AppConfig;
}): ToolDefinition[] {
  const tz = () => deps.config.USER_TIMEZONE;

  return [
    {
      name: "calendar_create_event",
      description:
        "Create an Apple Calendar event linked to an existing reminder. Always call reminder_create first, then pass its reminder_id. Default duration 30 minutes; alarms at 1h and 15m before start.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: {
            type: "string",
            description: "UUID of the reminder to link",
          },
          title: { type: "string", description: "Event title" },
          start: {
            type: "string",
            description: "Event start ISO-8601 (usually same as reminder fire_at)",
          },
          end: {
            type: "string",
            description: "Optional end ISO-8601; default start + 30 minutes",
          },
          notes: { type: "string", description: "Optional event notes" },
          raw_utterance: {
            type: "string",
            description: "Original user phrase",
          },
        },
        required: ["reminder_id", "title", "start"],
      },
      handler: async (raw) => {
        const schema = z.object({
          reminder_id: z.string().uuid(),
          title: z.string().min(1),
          start: z.string().min(1),
          end: z.string().optional(),
          notes: z.string().optional(),
          raw_utterance: z.string().optional(),
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const reminder = await deps.store.getById(parsed.data.reminder_id);
        if (!reminder) {
          return { ok: false, error: "Reminder not found" };
        }
        if (reminder.status === "cancelled") {
          return { ok: false, error: "Reminder is cancelled" };
        }
        if (reminder.calendarUid) {
          return {
            ok: false,
            error: "Reminder already linked to a calendar event",
          };
        }
        const start = parseIso(parsed.data.start);
        if (!start) {
          return { ok: false, error: "Invalid start ISO timestamp" };
        }
        let end: Date | undefined;
        if (parsed.data.end) {
          const e = parseIso(parsed.data.end);
          if (!e) return { ok: false, error: "Invalid end ISO timestamp" };
          end = e;
        }
        const uid = randomUUID();
        const created = await deps.calendar.createEvent({
          uid,
          title: parsed.data.title,
          start,
          end,
          description: parsed.data.notes,
          timeZone: tz(),
        });
        if (!created.ok) {
          return { ok: false, error: created.error };
        }
        const linked = await deps.store.setCalendarLink(reminder.id, {
          uid: created.data.uid,
          href: created.data.href,
          endAt: created.data.end,
        });
        if (!linked) {
          return {
            ok: false,
            error: "Event created but failed to save calendar link on reminder",
          };
        }
        return {
          ok: true,
          data: {
            event_uid: created.data.uid,
            reminder_id: reminder.id,
            title: parsed.data.title,
            start: start.toISOString(),
            end: created.data.end.toISOString(),
            start_local: formatLocal(start, tz()),
            end_local: formatLocal(created.data.end, tz()),
            reminder: toPublic(linked),
          },
        };
      },
    },
    {
      name: "calendar_list",
      description:
        "List Apple Calendar events in a time range. Default: now to +2 days.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "ISO start (inclusive)" },
          to: { type: "string", description: "ISO end (inclusive)" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
      handler: async (raw) => {
        const schema = z.object({
          from: z.string().optional(),
          to: z.string().optional(),
          limit: z.number().int().min(1).max(50).optional(),
        });
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const now = new Date();
        const from = parsed.data.from ? parseIso(parsed.data.from) : now;
        const to = parsed.data.to
          ? parseIso(parsed.data.to)
          : new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
        if (!from || !to) {
          return { ok: false, error: "Invalid from/to ISO timestamp" };
        }
        const listed = await deps.calendar.listEvents({
          from,
          to,
          limit: parsed.data.limit ?? 30,
        });
        if (!listed.ok) {
          return { ok: false, error: listed.error };
        }
        const links = await deps.store.getByCalendarUids(
          listed.data.events.map((e) => e.uid),
        );
        const byUid = new Map(links.map((r) => [r.calendarUid!, r.id]));
        const events = listed.data.events.map((e) => ({
          ...e,
          reminder_id: byUid.get(e.uid) ?? null,
        }));
        return { ok: true, data: { events, count: events.length } };
      },
    },
    {
      name: "calendar_update_event",
      description:
        "Update an Apple Calendar event by reminder_id or event_uid. May also update the linked reminder text/fire_at.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: { type: "string" },
          event_uid: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          notes: { type: "string" },
        },
      },
      handler: async (raw) => {
        const schema = z
          .object({
            reminder_id: z.string().uuid().optional(),
            event_uid: z.string().min(1).optional(),
            title: z.string().min(1).optional(),
            start: z.string().optional(),
            end: z.string().optional(),
            notes: z.string().optional(),
          })
          .refine((v) => Boolean(v.reminder_id || v.event_uid), {
            message: "Provide reminder_id or event_uid",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        let reminder: ReminderRecord | null = null;
        if (parsed.data.reminder_id) {
          reminder = await deps.store.getById(parsed.data.reminder_id);
        } else if (parsed.data.event_uid) {
          reminder = await deps.store.getByCalendarUid(parsed.data.event_uid);
        }
        if (!reminder?.calendarUid || !reminder.calendarHref) {
          return {
            ok: false,
            error: "No linked calendar event found for this id",
          };
        }
        let start = reminder.fireAt;
        if (parsed.data.start) {
          const d = parseIso(parsed.data.start);
          if (!d) return { ok: false, error: "Invalid start" };
          start = d;
        }
        const priorDurationMs = reminder.calendarEndAt
          ? Math.max(
              reminder.calendarEndAt.getTime() - reminder.fireAt.getTime(),
              30 * 60 * 1000,
            )
          : 30 * 60 * 1000;
        let end = new Date(start.getTime() + priorDurationMs);
        if (parsed.data.end) {
          const d = parseIso(parsed.data.end);
          if (!d) return { ok: false, error: "Invalid end" };
          end = d;
        }
        const title = parsed.data.title ?? reminder.text;
        const updated = await deps.calendar.updateEvent(reminder.calendarHref, {
          uid: reminder.calendarUid,
          title,
          start,
          end,
          description: parsed.data.notes,
          timeZone: tz(),
        });
        if (!updated.ok) {
          return { ok: false, error: updated.error };
        }
        const patch: {
          text?: string;
          fireAt?: Date;
          calendarEndAt?: Date;
          status?: "pending";
        } = { calendarEndAt: end };
        if (parsed.data.title !== undefined) patch.text = title;
        if (parsed.data.start !== undefined) {
          patch.fireAt = start;
          patch.status = "pending";
        }
        const saved = await deps.store.update(reminder.id, patch);
        return {
          ok: true,
          data: {
            event_uid: reminder.calendarUid,
            reminder_id: reminder.id,
            title,
            start: start.toISOString(),
            end: end.toISOString(),
            reminder: saved ? toPublic(saved) : toPublic(reminder),
          },
        };
      },
    },
    {
      name: "calendar_delete_event",
      description:
        "Delete an Apple Calendar event by reminder_id or event_uid. Does not cancel the reminder — use reminder_cancel to cancel both.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: { type: "string" },
          event_uid: { type: "string" },
        },
      },
      handler: async (raw) => {
        const schema = z
          .object({
            reminder_id: z.string().uuid().optional(),
            event_uid: z.string().min(1).optional(),
          })
          .refine((v) => Boolean(v.reminder_id || v.event_uid), {
            message: "Provide reminder_id or event_uid",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        let reminder: ReminderRecord | null = null;
        if (parsed.data.reminder_id) {
          reminder = await deps.store.getById(parsed.data.reminder_id);
        } else if (parsed.data.event_uid) {
          reminder = await deps.store.getByCalendarUid(parsed.data.event_uid);
        }
        if (!reminder?.calendarHref) {
          return {
            ok: false,
            error: "No linked calendar event found for this id",
          };
        }
        const deleted = await deleteLinkedCalendarEvent({
          calendar: deps.calendar,
          store: deps.store,
          reminder,
        });
        if (!deleted.deleted) {
          return {
            ok: false,
            error: deleted.error ?? "Failed to delete calendar event",
          };
        }
        const refreshed = await deps.store.getById(reminder.id);
        return {
          ok: true,
          data: {
            deleted: true,
            reminder_id: reminder.id,
            reminder: refreshed ? toPublic(refreshed) : null,
          },
        };
      },
    },
  ];
}
