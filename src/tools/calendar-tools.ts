import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type {
  CalendarEventInput,
  CalendarEventPatch,
  ICloudCalendarClient,
} from "../calendar/icloud-client.js";
import { DEFAULT_ALARM_MINUTES_BEFORE } from "../calendar/ics.js";
import { formatLocal } from "../utils/time/index.js";
import { toPublic, type ReminderStore } from "../reminders/store.js";
import type { ReminderRecord } from "../reminders/types.js";
import { type ToolDefinition, z } from "./gateway.js";

const alarmMinutesBeforeSchema = z
  .array(z.number().int().nonnegative().max(10080))
  .nullable()
  .optional();

/** Map tool param: omitted → undefined (client default/preserve); null → defaults; array → as-is. */
function alarmMinutesFromToolParam(
  value: number[] | null | undefined,
): number[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [...DEFAULT_ALARM_MINUTES_BEFORE];
  return value;
}

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

export function icsLocationFromFields(opts: {
  locationName?: string | null;
  locationAddress?: string | null;
}): string | undefined {
  const address = opts.locationAddress?.trim();
  if (address) return address;
  const name = opts.locationName?.trim();
  return name || undefined;
}

export function assembleEventDescription(opts: {
  notes?: string | null;
  mapsUrl?: string | null;
}): string | undefined {
  const parts: string[] = [];
  const notes = opts.notes?.trim();
  if (notes) parts.push(notes);
  const url = opts.mapsUrl?.trim();
  if (url) parts.push(url);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export function geoFromFields(opts: {
  locationLat?: number | null;
  locationLon?: number | null;
}): { lat: number; lon: number } | undefined {
  const lat = opts.locationLat;
  const lon = opts.locationLon;
  if (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lon === "number" &&
    Number.isFinite(lon)
  ) {
    return { lat, lon };
  }
  return undefined;
}

function locationChanged(
  before: ReminderRecord,
  after: ReminderRecord,
): boolean {
  return (
    before.locationName !== after.locationName ||
    before.locationAddress !== after.locationAddress ||
    before.locationMapsUrl !== after.locationMapsUrl ||
    before.locationLat !== after.locationLat ||
    before.locationLon !== after.locationLon
  );
}

function eventInputFromReminder(
  reminder: ReminderRecord,
  opts: {
    uid: string;
    title: string;
    start: Date;
    end: Date;
    timeZone: string;
    notes?: string | null;
    alarmMinutesBefore?: number[];
  },
): CalendarEventInput {
  const input: CalendarEventInput = {
    uid: opts.uid,
    title: opts.title,
    start: opts.start,
    end: opts.end,
    timeZone: opts.timeZone,
    location: icsLocationFromFields(reminder),
    geo: geoFromFields(reminder),
    description: assembleEventDescription({
      notes: opts.notes,
      mapsUrl: reminder.locationMapsUrl,
    }),
  };
  if (opts.alarmMinutesBefore !== undefined) {
    input.alarmMinutesBefore = opts.alarmMinutesBefore;
  }
  return input;
}

const locationToolFields = {
  location_name: z.string().min(1).nullable().optional(),
  location_address: z.string().min(1).nullable().optional(),
  location_maps_url: z.string().url().nullable().optional(),
  location_lat: z.number().finite().nullable().optional(),
  location_lon: z.number().finite().nullable().optional(),
};

type LocationToolInput = {
  location_name?: string | null;
  location_address?: string | null;
  location_maps_url?: string | null;
  location_lat?: number | null;
  location_lon?: number | null;
};

function resolveLocation(
  reminder: ReminderRecord,
  input: LocationToolInput,
): Pick<
  ReminderRecord,
  | "locationName"
  | "locationAddress"
  | "locationMapsUrl"
  | "locationLat"
  | "locationLon"
> {
  return {
    locationName:
      input.location_name !== undefined
        ? input.location_name
        : reminder.locationName,
    locationAddress:
      input.location_address !== undefined
        ? input.location_address
        : reminder.locationAddress,
    locationMapsUrl:
      input.location_maps_url !== undefined
        ? input.location_maps_url
        : reminder.locationMapsUrl,
    locationLat:
      input.location_lat !== undefined
        ? input.location_lat
        : reminder.locationLat,
    locationLon:
      input.location_lon !== undefined
        ? input.location_lon
        : reminder.locationLon,
  };
}

function locationPatchFromResolved(
  loc: ReturnType<typeof resolveLocation>,
  input: LocationToolInput,
): {
  locationName?: string | null;
  locationAddress?: string | null;
  locationMapsUrl?: string | null;
  locationLat?: number | null;
  locationLon?: number | null;
} {
  const patch: {
    locationName?: string | null;
    locationAddress?: string | null;
    locationMapsUrl?: string | null;
    locationLat?: number | null;
    locationLon?: number | null;
  } = {};
  if (input.location_name !== undefined) patch.locationName = loc.locationName;
  if (input.location_address !== undefined) {
    patch.locationAddress = loc.locationAddress;
  }
  if (input.location_maps_url !== undefined) {
    patch.locationMapsUrl = loc.locationMapsUrl;
  }
  if (input.location_lat !== undefined) patch.locationLat = loc.locationLat;
  if (input.location_lon !== undefined) patch.locationLon = loc.locationLon;
  return patch;
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
  const locChanged = locationChanged(opts.before, opts.after);
  if (!textChanged && !timeChanged && !locChanged) {
    return { ok: true };
  }
  const duration = eventDurationMs(opts.before);
  const end = new Date(opts.after.fireAt.getTime() + duration);
  const updated = await opts.calendar.updateEvent(
    opts.before.calendarHref,
    eventInputFromReminder(opts.after, {
      uid: opts.before.calendarUid,
      title: opts.after.text,
      start: opts.after.fireAt,
      end,
      timeZone: opts.timeZone,
    }),
  );
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
        "Create an Apple Calendar event linked to an existing reminder. Always call reminder_create first, then pass its reminder_id. Default duration 30 minutes; default alarms at 1h and 15m before start (override with alarm_minutes_before: [] to clear, [30] for custom, etc.). Location fields default from the reminder (places_search → reminder_create).",
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
          alarm_minutes_before: {
            type: "array",
            items: { type: "integer" },
            description:
              "Minutes before start for Apple Calendar alerts. Omit for default [60, 15]. Pass [] for no alerts. Pass e.g. [30] or [120, 15] for custom.",
          },
          location_name: {
            type: "string",
            description: "Place name; defaults to reminder",
          },
          location_address: {
            type: "string",
            description: "Address for Apple Calendar LOCATION; defaults to reminder",
          },
          location_maps_url: {
            type: "string",
            description: "Google Maps URL for DESCRIPTION; defaults to reminder",
          },
          location_lat: { type: "number" },
          location_lon: { type: "number" },
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
          alarm_minutes_before: alarmMinutesBeforeSchema,
          raw_utterance: z.string().optional(),
          ...locationToolFields,
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
        const loc = resolveLocation(reminder, parsed.data);
        const withLoc: ReminderRecord = { ...reminder, ...loc };
        const uid = randomUUID();
        const created = await deps.calendar.createEvent(
          eventInputFromReminder(withLoc, {
            uid,
            title: parsed.data.title,
            start,
            end: end ?? new Date(start.getTime() + 30 * 60 * 1000),
            timeZone: tz(),
            notes: parsed.data.notes,
            alarmMinutesBefore: alarmMinutesFromToolParam(
              parsed.data.alarm_minutes_before,
            ),
          }),
        );
        if (!created.ok) {
          return { ok: false, error: created.error };
        }
        const locPatch = locationPatchFromResolved(loc, parsed.data);
        if (Object.keys(locPatch).length > 0) {
          await deps.store.update(reminder.id, locPatch);
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
        const refreshed = await deps.store.getById(reminder.id);
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
            location: icsLocationFromFields(withLoc) ?? null,
            reminder: toPublic(refreshed ?? linked),
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
        "Update an Apple Calendar event by reminder_id or event_uid. Only pass fields you want to change — omitted fields (including duration) are preserved. May also update the linked reminder text/fire_at/location when those fields are set. Omit alarm_minutes_before to keep existing Apple alerts; pass [] to clear, null to restore default 1h+15m, or a custom minute list.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: { type: "string" },
          event_uid: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          notes: { type: "string" },
          alarm_minutes_before: {
            type: "array",
            items: { type: "integer" },
            description:
              "Minutes before start for Apple Calendar alerts. Omit to preserve existing. [] clears. null restores default [60, 15]. When changing only alerts, do not pass start/end/title.",
          },
          location_name: { type: "string" },
          location_address: { type: "string" },
          location_maps_url: { type: "string" },
          location_lat: { type: "number" },
          location_lon: { type: "number" },
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
            alarm_minutes_before: alarmMinutesBeforeSchema,
            ...locationToolFields,
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

        const locationInputProvided =
          parsed.data.location_name !== undefined ||
          parsed.data.location_address !== undefined ||
          parsed.data.location_maps_url !== undefined ||
          parsed.data.location_lat !== undefined ||
          parsed.data.location_lon !== undefined;

        const patch: CalendarEventPatch = {
          uid: reminder.calendarUid,
          timeZone: tz(),
        };

        if (parsed.data.title !== undefined) {
          patch.title = parsed.data.title;
        }

        let start = reminder.fireAt;
        if (parsed.data.start !== undefined) {
          const d = parseIso(parsed.data.start);
          if (!d) return { ok: false, error: "Invalid start" };
          start = d;
          patch.start = start;
        }

        if (parsed.data.end !== undefined) {
          const d = parseIso(parsed.data.end);
          if (!d) return { ok: false, error: "Invalid end" };
          patch.end = d;
        } else if (parsed.data.start !== undefined) {
          // Start moved without explicit end — keep prior duration from reminder.
          const duration = eventDurationMs(reminder);
          patch.end = new Date(start.getTime() + duration);
        }

        // When rewriting VEVENT without an explicit start from the model, pin
        // start (and end if needed) from the linked reminder so a prior bad
        // TZID parse in CalDAV cannot shift the wall clock.
        const rewritingWithoutExplicitStart =
          parsed.data.start === undefined &&
          (locationInputProvided ||
            parsed.data.title !== undefined ||
            parsed.data.notes !== undefined ||
            parsed.data.end !== undefined);
        if (rewritingWithoutExplicitStart) {
          patch.start = reminder.fireAt;
          if (parsed.data.end === undefined) {
            patch.end = new Date(
              reminder.fireAt.getTime() + eventDurationMs(reminder),
            );
          }
        }

        if (parsed.data.notes !== undefined) {
          const locForNotes = resolveLocation(reminder, parsed.data);
          patch.description = assembleEventDescription({
            notes: parsed.data.notes,
            mapsUrl: locForNotes.locationMapsUrl,
          });
        }

        if (locationInputProvided) {
          const loc = resolveLocation(reminder, parsed.data);
          patch.location = icsLocationFromFields(loc);
          const geo = geoFromFields(loc);
          if (geo) patch.geo = geo;
        }

        if (parsed.data.alarm_minutes_before !== undefined) {
          patch.alarmMinutesBefore = alarmMinutesFromToolParam(
            parsed.data.alarm_minutes_before,
          );
        }

        const updated = await deps.calendar.updateEvent(
          reminder.calendarHref,
          patch,
        );
        if (!updated.ok) {
          return { ok: false, error: updated.error };
        }

        const loc = resolveLocation(reminder, parsed.data);
        const storePatch: {
          text?: string;
          fireAt?: Date;
          calendarEndAt?: Date;
          status?: "pending";
          locationName?: string | null;
          locationAddress?: string | null;
          locationMapsUrl?: string | null;
          locationLat?: number | null;
          locationLon?: number | null;
        } = {
          ...locationPatchFromResolved(loc, parsed.data),
        };
        if (parsed.data.title !== undefined) storePatch.text = parsed.data.title;
        if (parsed.data.start !== undefined) {
          storePatch.fireAt = start;
          storePatch.status = "pending";
        }
        if (
          parsed.data.start !== undefined ||
          parsed.data.end !== undefined
        ) {
          storePatch.calendarEndAt = updated.data.end;
        }

        const saved =
          Object.keys(storePatch).length > 0
            ? await deps.store.update(reminder.id, storePatch)
            : reminder;
        const withLoc: ReminderRecord = { ...reminder, ...loc };
        return {
          ok: true,
          data: {
            event_uid: reminder.calendarUid,
            reminder_id: reminder.id,
            title: parsed.data.title ?? reminder.text,
            start: (parsed.data.start !== undefined
              ? start
              : reminder.fireAt
            ).toISOString(),
            end: updated.data.end.toISOString(),
            location: icsLocationFromFields(
              locationInputProvided ? withLoc : reminder,
            ) ?? null,
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
