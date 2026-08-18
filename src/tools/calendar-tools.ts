import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type {
  CalendarEventInput,
  CalendarEventPatch,
  ICloudCalendarClient,
} from "../calendar/icloud-client.js";
import { assembleEventDescription } from "../calendar/event-description.js";
import {
  DEFAULT_ALARM_MINUTES_BEFORE,
  DEFAULT_EVENT_DURATION_MS,
} from "../calendar/ics.js";
import { toPublic, type EventStore } from "../events/store.js";
import type { EventRecord } from "../events/types.js";
import { syncAppleCalendarToEvents } from "../events/apple-sync.js";
import {
  findDuplicateCandidates,
  ON_DUPLICATE_CHOICES,
  type OnDuplicate,
} from "../calendar/duplicates.js";
import {
  dayEndUtc,
  dayStartUtc,
  formatLocal,
  localDateString,
  parseZonedDateTime,
} from "../utils/time/index.js";
import { logger, truncateForLog } from "../log.js";
import { classifyError, recordVoiceError } from "../telemetry.js";
import { type ToolDefinition, z } from "./gateway.js";

const alarmMinutesBeforeSchema = z
  .array(z.number().int().nonnegative().max(10080))
  .nullable()
  .optional();

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function parseToolDateTime(iso: string, timeZone: string): Date | null {
  return parseZonedDateTime(iso, timeZone);
}

/**
 * Resolve calendar_list from/to. YYYY-MM-DD is a full local day
 * (start inclusive → next midnight exclusive). Equal instants expand to
 * that local calendar day so CalDAV never sees start === end.
 */
export function resolveCalendarListRange(opts: {
  from?: string;
  to?: string;
  timeZone: string;
  now?: Date;
}): { ok: true; from: Date; to: Date } | { ok: false; error: string } {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone;

  const parseBound = (
    raw: string | undefined,
    role: "from" | "to",
  ): Date | null => {
    if (!raw) {
      return role === "from"
        ? now
        : new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    }
    const trimmed = raw.trim();
    if (DATE_ONLY_RE.test(trimmed)) {
      return role === "from"
        ? dayStartUtc(trimmed, tz)
        : dayEndUtc(trimmed, tz);
    }
    return parseIso(trimmed);
  };

  let from = parseBound(opts.from, "from");
  let to = parseBound(opts.to, "to");
  if (!from || !to) {
    return { ok: false, error: "Invalid from/to ISO timestamp" };
  }

  if (to.getTime() <= from.getTime()) {
    const day = localDateString(from, tz);
    from = dayStartUtc(day, tz);
    to = dayEndUtc(day, tz);
  }

  if (to.getTime() <= from.getTime()) {
    return {
      ok: false,
      error: "invalid timeRange: start must be before end",
    };
  }
  return { ok: true, from, to };
}

/** Public datetime pair for tool results: UTC ISO + user-local (for speech). */
function publicDateTimes(
  start: Date,
  end: Date,
  timeZone: string,
): {
  start_iso: string;
  end_iso: string;
  start_local: string;
  end_local: string;
} {
  return {
    start_iso: start.toISOString(),
    end_iso: end.toISOString(),
    start_local: formatLocal(start, timeZone),
    end_local: formatLocal(end, timeZone),
  };
}

function publicOptionalDateTimes(
  start: Date | null | undefined,
  end: Date | null | undefined,
  timeZone: string,
): {
  start_iso: string | null;
  end_iso: string | null;
  start_local: string | null;
  end_local: string | null;
} {
  return {
    start_iso: start ? start.toISOString() : null,
    end_iso: end ? end.toISOString() : null,
    start_local: start ? formatLocal(start, timeZone) : null,
    end_local: end ? formatLocal(end, timeZone) : null,
  };
}

function eventDurationMs(event: EventRecord): number {
  const ms = event.endAt.getTime() - event.startAt.getTime();
  if (ms > 0) return ms;
  return DEFAULT_EVENT_DURATION_MS;
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

function eventInputFromRecord(
  event: Pick<
    EventRecord,
    | "locationName"
    | "locationAddress"
    | "locationMapsUrl"
    | "locationLat"
    | "locationLon"
  >,
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
    location: icsLocationFromFields(event),
    geo: geoFromFields(event),
    description: assembleEventDescription({
      notes: opts.notes,
      mapsUrl: event.locationMapsUrl,
    }),
  };
  if (opts.alarmMinutesBefore !== undefined) {
    input.alarmMinutesBefore = opts.alarmMinutesBefore;
  }
  return input;
}

/** Empty / non-http(s) strings from the model become null instead of failing the tool. */
export function coerceOptionalHttpUrl(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

const optionalHttpUrl = z.preprocess(
  coerceOptionalHttpUrl,
  z.string().url().nullable().optional(),
);

const locationToolFields = {
  location_name: z.string().min(1).nullable().optional(),
  location_address: z.string().min(1).nullable().optional(),
  location_maps_url: optionalHttpUrl,
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
  current: Pick<
    EventRecord,
    | "locationName"
    | "locationAddress"
    | "locationMapsUrl"
    | "locationLat"
    | "locationLon"
  >,
  input: LocationToolInput,
): Pick<
  EventRecord,
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
        : current.locationName,
    locationAddress:
      input.location_address !== undefined
        ? input.location_address
        : current.locationAddress,
    locationMapsUrl:
      input.location_maps_url !== undefined
        ? input.location_maps_url
        : current.locationMapsUrl,
    locationLat:
      input.location_lat !== undefined
        ? input.location_lat
        : current.locationLat,
    locationLon:
      input.location_lon !== undefined
        ? input.location_lon
        : current.locationLon,
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

async function resolveEvent(
  store: EventStore,
  opts: { event_id?: string; event_uid?: string },
): Promise<
  | { ok: true; event: EventRecord }
  | { ok: false; error: string }
> {
  if (opts.event_id) {
    const event = await store.getById(opts.event_id);
    if (!event) return { ok: false, error: "Calendar event not found" };
    return { ok: true, event };
  }
  if (opts.event_uid) {
    const rows = await store.listByUid(opts.event_uid);
    if (rows.length === 0) {
      return { ok: false, error: "Calendar event not found" };
    }
    if (rows.length > 1) {
      return {
        ok: false,
        error:
          "Multiple events share this event_uid (recurring series). Use event_id.",
      };
    }
    return { ok: true, event: rows[0]! };
  }
  return { ok: false, error: "Provide event_id or event_uid" };
}

function rejectComplexWrite(event: EventRecord): string | null {
  if (event.isAllDay) {
    return "Updating/deleting all-day events is not supported yet";
  }
  if (event.recurrenceRule || event.recurrenceId) {
    return "Updating/deleting recurring events is not supported yet";
  }
  return null;
}

function pickReplaceTarget(
  matches: Array<{ uid: string; href: string; event_id: string | null }>,
  opts: { replace_event_id?: string; replace_event_uid?: string },
):
  | { ok: true; match: { uid: string; href: string; event_id: string | null } }
  | { ok: false; error: string } {
  if (matches.length === 0) {
    return { ok: false, error: "No matching event to replace" };
  }
  if (opts.replace_event_id) {
    const match = matches.find((m) => m.event_id === opts.replace_event_id);
    if (!match) {
      return {
        ok: false,
        error: "replace_event_id does not match a duplicate candidate",
      };
    }
    return { ok: true, match };
  }
  if (opts.replace_event_uid) {
    const match = matches.find((m) => m.uid === opts.replace_event_uid);
    if (!match) {
      return {
        ok: false,
        error: "replace_event_uid does not match a duplicate candidate",
      };
    }
    return { ok: true, match };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error:
        "Multiple similar events that day. Pass replace_event_id or replace_event_uid.",
    };
  }
  return { ok: true, match: matches[0]! };
}

export function createCalendarTools(deps: {
  calendar: ICloudCalendarClient;
  store: EventStore;
  config: AppConfig;
}): ToolDefinition[] {
  const tz = () => deps.config.USER_TIMEZONE;

  return [
    {
      name: "calendar_create_event",
      description:
        "Create an Apple Calendar event (standalone). start/end are user-local wall times: prefer naive ISO (2026-08-26T16:00:00) or numeric offset; never put Z on a local clock time. Default duration 30 minutes; default alarms at 1h and 15m before start. Pass location from places_search when the user names a venue. Before creating, checks Apple Calendar for overlapping times and similar events that day. If matches exist, does not create — returns need_clarification; ask the user skip / replace / keep both, then recall with on_duplicate. Result includes start_iso/end_iso and start_local/end_local — speak local fields only. Does not create or link a reminder.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          start: {
            type: "string",
            description:
              "Event start. Naive YYYY-MM-DDTHH:MM is USER_TIMEZONE wall time. Z/offset is an absolute instant.",
          },
          end: {
            type: "string",
            description:
              "Optional end (same rules as start); default start + 30 minutes",
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
            description: "Place name from places_search",
          },
          location_address: {
            type: "string",
            description: "Address for Apple Calendar LOCATION",
          },
          location_maps_url: {
            type: "string",
            description:
              "http(s) Maps URL for DESCRIPTION. Omit if unknown — never pass a place name or empty string.",
          },
          location_lat: { type: "number" },
          location_lon: { type: "number" },
          raw_utterance: {
            type: "string",
            description: "Original user phrase",
          },
          on_duplicate: {
            type: "string",
            enum: [...ON_DUPLICATE_CHOICES],
            description:
              "Required after need_clarification: skip (do not create), replace (delete the match then create), keep_both (create anyway). Omit on first call.",
          },
          replace_event_id: {
            type: "string",
            description:
              "When on_duplicate=replace and several matches, which local event_id to replace",
          },
          replace_event_uid: {
            type: "string",
            description:
              "When on_duplicate=replace and several matches, which Apple event_uid to replace",
          },
        },
        required: ["title", "start"],
      },
      handler: async (raw) => {
        const schema = z.object({
          title: z.string().min(1),
          start: z.string().min(1),
          end: z.string().optional(),
          notes: z.string().optional(),
          alarm_minutes_before: alarmMinutesBeforeSchema,
          raw_utterance: z.string().optional(),
          on_duplicate: z.enum(ON_DUPLICATE_CHOICES).optional(),
          replace_event_id: z.string().uuid().optional(),
          replace_event_uid: z.string().min(1).optional(),
          ...locationToolFields,
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const timeZone = tz();
        const start = parseToolDateTime(parsed.data.start, timeZone);
        if (!start) {
          return { ok: false, error: "Invalid start ISO timestamp" };
        }
        let end: Date;
        if (parsed.data.end) {
          const e = parseToolDateTime(parsed.data.end, timeZone);
          if (!e) return { ok: false, error: "Invalid end ISO timestamp" };
          if (e.getTime() <= start.getTime()) {
            return { ok: false, error: "end must be after start" };
          }
          end = e;
        } else {
          end = new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
        }

        const loc = resolveLocation(
          {
            locationName: null,
            locationAddress: null,
            locationMapsUrl: null,
            locationLat: null,
            locationLon: null,
          },
          parsed.data,
        );
        const location = icsLocationFromFields(loc) ?? null;
        const times = publicDateTimes(start, end, timeZone);
        const proposed = {
          title: parsed.data.title,
          location,
          ...times,
        };

        const onDuplicate: OnDuplicate | undefined = parsed.data.on_duplicate;
        const day = localDateString(start, timeZone);
        const listed = await deps.calendar.listEvents({
          from: dayStartUtc(day, timeZone),
          to: dayEndUtc(day, timeZone),
          limit: 50,
        });
        if (!listed.ok) {
          logger.warn("[calendar] create duplicate check failed", {
            component: "calendar",
            handler: "tool",
            step: "finish",
            tool: "calendar_create_event",
            result: "error",
            error_message: truncateForLog(listed.error),
          });
          recordVoiceError({
            errorType: classifyError(listed.error),
            handler: "tool",
          });
          return {
            ok: false,
            error: `Cannot check calendar for duplicates: ${listed.error}`,
          };
        }
        const local = await deps.store.getByUids(
          listed.data.events.map((e) => e.uid),
        );
        const byUid = new Map(local.map((e) => [e.uid, e]));
        const matches = findDuplicateCandidates({
          title: parsed.data.title,
          location,
          start,
          end,
          timeZone,
          events: listed.data.events.map((e) => ({
            uid: e.uid,
            href: e.href,
            event_id: byUid.get(e.uid)?.id ?? null,
            title: e.title,
            location: e.location,
            start: e.start ? parseIso(e.start) : null,
            end: e.end ? parseIso(e.end) : null,
            isAllDay: e.isAllDay,
          })),
        });

        if (matches.length > 0 && !onDuplicate) {
          logger.info("[calendar] create needs duplicate choice", {
            component: "calendar",
            handler: "tool",
            step: "finish",
            tool: "calendar_create_event",
            result: "clarification",
            count: matches.length,
            start_iso: times.start_iso,
            start_local: times.start_local,
          });
          return {
            ok: true,
            data: {
              need_clarification: true,
              reason: "duplicate_or_similar",
              choices: [...ON_DUPLICATE_CHOICES],
              proposed,
              matches,
            },
          };
        }

        if (matches.length > 0 && onDuplicate === "skip") {
          logger.info("[calendar] create skipped duplicate", {
            component: "calendar",
            handler: "tool",
            step: "finish",
            tool: "calendar_create_event",
            result: "skipped",
            count: matches.length,
            start_iso: times.start_iso,
            start_local: times.start_local,
          });
          return {
            ok: true,
            data: {
              skipped: true,
              reason: "duplicate",
              proposed,
              matches,
            },
          };
        }

        if (matches.length > 0 && onDuplicate === "replace") {
          const target = pickReplaceTarget(matches, parsed.data);
          if (!target.ok) return { ok: false, error: target.error };
          const existing = byUid.get(target.match.uid);
          const complex = existing ? rejectComplexWrite(existing) : null;
          if (complex) return { ok: false, error: complex };
          const listedMatch = listed.data.events.find(
            (e) => e.uid === target.match.uid,
          );
          if (listedMatch?.recurrenceRule || listedMatch?.recurrenceId) {
            return {
              ok: false,
              error:
                "Replacing recurring events is not supported yet. Use skip or keep_both.",
            };
          }
          if (listedMatch?.isAllDay) {
            return {
              ok: false,
              error:
                "Replacing all-day events is not supported yet. Use skip or keep_both.",
            };
          }
          const deleted = await deps.calendar.deleteEvent(target.match.href);
          if (!deleted.ok) {
            logger.warn("[calendar] replace delete failed", {
              component: "calendar",
              handler: "tool",
              step: "finish",
              tool: "calendar_create_event",
              result: "error",
              error_message: truncateForLog(deleted.error),
            });
            return { ok: false, error: deleted.error };
          }
          if (existing) await deps.store.delete(existing.id);
        }

        const alarms = alarmMinutesFromToolParam(
          parsed.data.alarm_minutes_before,
        );
        const resolvedAlarms =
          alarms === undefined ? [...DEFAULT_ALARM_MINUTES_BEFORE] : alarms;
        const uid = randomUUID();
        const created = await deps.calendar.createEvent(
          eventInputFromRecord(loc, {
            uid,
            title: parsed.data.title,
            start,
            end,
            timeZone,
            notes: parsed.data.notes,
            alarmMinutesBefore: resolvedAlarms,
          }),
        );
        if (!created.ok) {
          logger.warn("[calendar] create failed", {
            component: "calendar",
            handler: "tool",
            step: "finish",
            tool: "calendar_create_event",
            result: "error",
            start_iso: times.start_iso,
            start_local: times.start_local,
            error_message: truncateForLog(created.error),
          });
          recordVoiceError({
            errorType: classifyError(created.error),
            handler: "tool",
          });
          return { ok: false, error: created.error };
        }

        let saved: EventRecord;
        try {
          saved = await deps.store.create({
            uid: created.data.uid,
            href: created.data.href,
            title: parsed.data.title,
            startAt: start,
            endAt: created.data.end,
            timezone: timeZone,
            notes: parsed.data.notes ?? null,
            alarmMinutesBefore: resolvedAlarms,
            recurrenceId: "",
            recurrenceRule: null,
            isAllDay: false,
            locationName: loc.locationName,
            locationAddress: loc.locationAddress,
            locationMapsUrl: loc.locationMapsUrl,
            locationLat: loc.locationLat,
            locationLon: loc.locationLon,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn("[calendar] create DB failed; compensating delete", {
            component: "calendar",
            handler: "tool",
            step: "finish",
            tool: "calendar_create_event",
            result: "error",
            start_iso: times.start_iso,
            start_local: times.start_local,
            error_message: truncateForLog(message),
          });
          await deps.calendar.deleteEvent(created.data.href).catch(() => undefined);
          return {
            ok: false,
            error: `Event created in Apple Calendar but failed to save locally: ${message}`,
          };
        }

        logger.info("[calendar] create", {
          component: "calendar",
          handler: "tool",
          step: "finish",
          tool: "calendar_create_event",
          result: "success",
          start: truncateForLog(parsed.data.start, 64),
          start_iso: times.start_iso,
          start_local: times.start_local,
        });
        return {
          ok: true,
          data: {
            ...toPublic(saved),
            location,
          },
        };
      },
    },
    {
      name: "calendar_sync",
      description:
        "Full sync of the configured Apple Calendar into local events. Apple Calendar is the source of truth: creates/updates local rows from Apple and deletes local events missing remotely. Call ONLY when the user explicitly asks to sync the calendar. Does not write to Apple.",
      parameters: {
        type: "object",
        properties: {},
      },
      handler: async () => {
        const result = await syncAppleCalendarToEvents({
          calendar: deps.calendar,
          store: deps.store,
          defaultTimeZone: tz(),
        });
        if (!result.ok) {
          return { ok: false, error: result.error, data: result.data };
        }
        return { ok: true, data: result.data };
      },
    },
    {
      name: "calendar_list",
      description:
        "List Apple Calendar events in a time range. Default: now to +2 days. Prefer YYYY-MM-DD for a whole local day (from and to may be the same date). Each event includes start_iso/end_iso (machine) and start_local/end_local (speak these). Jarvis-managed events also include event_id when matched by UID.",
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description:
              "ISO datetime or YYYY-MM-DD (local day start, inclusive)",
          },
          to: {
            type: "string",
            description:
              "ISO datetime or YYYY-MM-DD (local day end, exclusive next midnight). Same date as from = that full day.",
          },
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
        const started = Date.now();
        const fromDefaulted = !parsed.data.from;
        const toDefaulted = !parsed.data.to;
        const timeZone = tz();
        const range = resolveCalendarListRange({
          from: parsed.data.from,
          to: parsed.data.to,
          timeZone,
        });
        if (!range.ok) {
          return { ok: false, error: range.error };
        }
        const { from, to } = range;
        const limit = parsed.data.limit ?? 30;
        const listed = await deps.calendar.listEvents({
          from,
          to,
          limit,
        });
        if (!listed.ok) {
          logger.warn("[calendar] list failed", {
            component: "calendar",
            handler: "tool",
            step: "finish",
            tool: "calendar_list",
            result: "error",
            from: from.toISOString(),
            to: to.toISOString(),
            limit,
            from_defaulted: fromDefaulted,
            to_defaulted: toDefaulted,
            duration_ms: Date.now() - started,
            error_message: truncateForLog(listed.error),
          });
          return { ok: false, error: listed.error };
        }
        const local = await deps.store.getByUids(
          listed.data.events.map((e) => e.uid),
        );
        const byUid = new Map(local.map((e) => [e.uid, e.id]));
        const events = listed.data.events.map((e) => {
          const start = e.start ? parseIso(e.start) : null;
          const end = e.end ? parseIso(e.end) : null;
          return {
            uid: e.uid,
            href: e.href,
            event_id: byUid.get(e.uid) ?? null,
            title: e.title,
            notes: e.notes,
            location: e.location,
            geo: e.geo,
            ...publicOptionalDateTimes(start, end, timeZone),
          };
        });
        logger.info("[calendar] list", {
          component: "calendar",
          handler: "tool",
          step: "finish",
          tool: "calendar_list",
          result: "success",
          from: from.toISOString(),
          to: to.toISOString(),
          limit,
          count: events.length,
          from_defaulted: fromDefaulted,
          to_defaulted: toDefaulted,
          duration_ms: Date.now() - started,
        });
        return { ok: true, data: { events, count: events.length } };
      },
    },
    {
      name: "calendar_update_event",
      description:
        "Update an Apple Calendar event by event_id or event_uid. Only pass fields you want to change — omitted fields (including duration) are preserved. Omit alarm_minutes_before to keep existing Apple alerts; pass [] to clear, null to restore default 1h+15m, or a custom minute list. Result includes start_iso/end_iso and start_local/end_local — speak local fields only.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
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
          location_maps_url: {
            type: "string",
            description:
              "http(s) Maps URL. Omit if unknown — never pass a place name or empty string.",
          },
          location_lat: { type: "number" },
          location_lon: { type: "number" },
        },
      },
      handler: async (raw) => {
        const schema = z
          .object({
            event_id: z.string().uuid().optional(),
            event_uid: z.string().min(1).optional(),
            title: z.string().min(1).optional(),
            start: z.string().optional(),
            end: z.string().optional(),
            notes: z.string().optional(),
            alarm_minutes_before: alarmMinutesBeforeSchema,
            ...locationToolFields,
          })
          .refine((v) => Boolean(v.event_id || v.event_uid), {
            message: "Provide event_id or event_uid",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const resolved = await resolveEvent(deps.store, parsed.data);
        if (!resolved.ok) {
          return { ok: false, error: resolved.error };
        }
        const event = resolved.event;
        const complex = rejectComplexWrite(event);
        if (complex) return { ok: false, error: complex };

        const locationInputProvided =
          parsed.data.location_name !== undefined ||
          parsed.data.location_address !== undefined ||
          parsed.data.location_maps_url !== undefined ||
          parsed.data.location_lat !== undefined ||
          parsed.data.location_lon !== undefined;

        const patch: CalendarEventPatch = {
          uid: event.uid,
          timeZone: tz(),
        };

        if (parsed.data.title !== undefined) {
          patch.title = parsed.data.title;
        }

        let start = event.startAt;
        if (parsed.data.start !== undefined) {
          const d = parseToolDateTime(parsed.data.start, tz());
          if (!d) return { ok: false, error: "Invalid start" };
          start = d;
          patch.start = start;
        }

        if (parsed.data.end !== undefined) {
          const d = parseToolDateTime(parsed.data.end, tz());
          if (!d) return { ok: false, error: "Invalid end" };
          if (d.getTime() <= start.getTime()) {
            return { ok: false, error: "end must be after start" };
          }
          patch.end = d;
        } else if (parsed.data.start !== undefined) {
          const duration = eventDurationMs(event);
          patch.end = new Date(start.getTime() + duration);
        }

        const rewritingWithoutExplicitStart =
          parsed.data.start === undefined &&
          (locationInputProvided ||
            parsed.data.title !== undefined ||
            parsed.data.notes !== undefined ||
            parsed.data.end !== undefined);
        if (rewritingWithoutExplicitStart) {
          patch.start = event.startAt;
          if (parsed.data.end === undefined) {
            patch.end = new Date(
              event.startAt.getTime() + eventDurationMs(event),
            );
          }
        }

        if (parsed.data.notes !== undefined) {
          const locForNotes = resolveLocation(event, parsed.data);
          patch.description = assembleEventDescription({
            notes: parsed.data.notes,
            mapsUrl: locForNotes.locationMapsUrl,
          });
        }

        if (locationInputProvided) {
          const loc = resolveLocation(event, parsed.data);
          patch.location = icsLocationFromFields(loc);
          const geo = geoFromFields(loc);
          if (geo) patch.geo = geo;
          if (parsed.data.notes === undefined) {
            patch.mapsUrl = loc.locationMapsUrl ?? null;
          }
        }

        if (parsed.data.alarm_minutes_before !== undefined) {
          patch.alarmMinutesBefore = alarmMinutesFromToolParam(
            parsed.data.alarm_minutes_before,
          );
        }

        const updated = await deps.calendar.updateEvent(event.href, patch);
        if (!updated.ok) {
          logger.warn("[calendar] update failed", {
            component: "calendar",
            handler: "tool",
            step: "finish",
            tool: "calendar_update_event",
            result: "error",
            error_message: truncateForLog(updated.error),
          });
          return { ok: false, error: updated.error };
        }

        const loc = resolveLocation(event, parsed.data);
        const storePatch: {
          title?: string;
          startAt?: Date;
          endAt?: Date;
          notes?: string | null;
          alarmMinutesBefore?: number[] | null;
          locationName?: string | null;
          locationAddress?: string | null;
          locationMapsUrl?: string | null;
          locationLat?: number | null;
          locationLon?: number | null;
        } = {
          ...locationPatchFromResolved(loc, parsed.data),
        };
        if (parsed.data.title !== undefined) storePatch.title = parsed.data.title;
        if (parsed.data.start !== undefined) storePatch.startAt = start;
        if (
          parsed.data.start !== undefined ||
          parsed.data.end !== undefined
        ) {
          storePatch.endAt = updated.data.end;
        }
        if (parsed.data.notes !== undefined) {
          storePatch.notes = parsed.data.notes;
        }
        if (parsed.data.alarm_minutes_before !== undefined) {
          storePatch.alarmMinutesBefore =
            alarmMinutesFromToolParam(parsed.data.alarm_minutes_before) ?? null;
        }

        const saved =
          Object.keys(storePatch).length > 0
            ? await deps.store.update(event.id, storePatch)
            : event;
        const withLoc = { ...event, ...loc };
        const resultStart =
          parsed.data.start !== undefined ? start : event.startAt;
        return {
          ok: true,
          data: {
            ...(saved ? toPublic(saved) : toPublic(event)),
            ...publicDateTimes(resultStart, updated.data.end, tz()),
            location: icsLocationFromFields(
              locationInputProvided ? withLoc : event,
            ) ?? null,
          },
        };
      },
    },
    {
      name: "calendar_delete_event",
      description:
        "Delete an Apple Calendar event by event_id or event_uid. Does not affect reminders.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_uid: { type: "string" },
        },
      },
      handler: async (raw) => {
        const schema = z
          .object({
            event_id: z.string().uuid().optional(),
            event_uid: z.string().min(1).optional(),
          })
          .refine((v) => Boolean(v.event_id || v.event_uid), {
            message: "Provide event_id or event_uid",
          });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.message };
        }
        const resolved = await resolveEvent(deps.store, parsed.data);
        if (!resolved.ok) {
          return { ok: false, error: resolved.error };
        }
        const event = resolved.event;
        const complex = rejectComplexWrite(event);
        if (complex) return { ok: false, error: complex };
        const deleted = await deps.calendar.deleteEvent(event.href);
        if (!deleted.ok) {
          logger.warn("[calendar] delete failed", {
            component: "calendar",
            handler: "tool",
            step: "finish",
            tool: "calendar_delete_event",
            result: "error",
            error_message: truncateForLog(deleted.error),
          });
          return { ok: false, error: deleted.error };
        }
        await deps.store.delete(event.id);
        return {
          ok: true,
          data: {
            deleted: true,
            event_id: event.id,
            event_uid: event.uid,
          },
        };
      },
    },
  ];
}
