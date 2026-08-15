import { randomUUID } from "node:crypto";
import type { ICloudCalendarClient } from "../calendar/icloud-client.js";
import { DEFAULT_EVENT_DURATION_MS } from "../calendar/ics.js";
import { logger, truncateForLog } from "../log.js";
import { classifyError, recordVoiceError } from "../telemetry.js";
import type { EventStore, EventUpsertInput } from "./store.js";
import { normalizeRecurrenceId } from "./types.js";

export type AppleSyncSummary = {
  sync_id: string;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  skipped: number;
  remote_count: number;
  errors: string[];
};

function parseIso(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function syncAppleCalendarToEvents(opts: {
  calendar: ICloudCalendarClient;
  store: EventStore;
  defaultTimeZone: string;
}): Promise<
  | { ok: true; data: AppleSyncSummary }
  | { ok: false; error: string; data?: Partial<AppleSyncSummary> }
> {
  const syncId = randomUUID();
  const started = Date.now();
  logger.info("[calendar] sync start", {
    component: "calendar",
    handler: "tool",
    step: "start",
    tool: "calendar_sync",
  });

  const fetched = await opts.calendar.fetchAllEvents();
  if (!fetched.ok) {
    const errorType = classifyError(fetched.error);
    recordVoiceError({ errorType, handler: "tool" });
    logger.warn("[calendar] sync fetch failed", {
      component: "calendar",
      handler: "tool",
      step: "finish",
      tool: "calendar_sync",
      result: "error",
      duration_ms: Date.now() - started,
      error_message: truncateForLog(fetched.error),
      error_type: errorType,
    });
    return { ok: false, error: fetched.error };
  }

  if (!fetched.data.complete) {
    logger.warn("[calendar] sync incomplete snapshot; aborting deletes", {
      component: "calendar",
      handler: "tool",
      step: "finish",
      tool: "calendar_sync",
      result: "error",
      duration_ms: Date.now() - started,
    });
    recordVoiceError({ errorType: "unknown", handler: "tool" });
    return {
      ok: false,
      error:
        "Apple Calendar snapshot was incomplete (parse failures). Local events were not deleted.",
      data: {
        sync_id: syncId,
        remote_count: fetched.data.events.length,
        skipped: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        deleted: 0,
        errors: ["incomplete_snapshot"],
      },
    };
  }

  const upserts: EventUpsertInput[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (const remote of fetched.data.events) {
    if (remote.cancelled) {
      // Absent from active set → will be deleted if previously local.
      skipped += 1;
      continue;
    }
    const start = parseIso(remote.start);
    if (!start) {
      skipped += 1;
      errors.push(`skip_no_start:${remote.uid}`);
      continue;
    }
    let end = parseIso(remote.end);
    if (!end || end.getTime() <= start.getTime()) {
      end = remote.isAllDay
        ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
        : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
    }
    const timezone =
      remote.timeZone?.trim() || opts.defaultTimeZone;
    upserts.push({
      uid: remote.uid,
      recurrenceId: normalizeRecurrenceId(remote.recurrenceId),
      href: remote.href,
      title: remote.title || "(untitled)",
      startAt: start,
      endAt: end,
      timezone,
      notes: remote.notes,
      alarmMinutesBefore: remote.alarmMinutesBefore,
      recurrenceRule: remote.recurrenceRule,
      isAllDay: remote.isAllDay,
      sourceUpdatedAt: parseIso(remote.sourceUpdatedAt),
      lastSeenSyncId: syncId,
      // Import raw LOCATION into address; do not invent name/maps split.
      locationName: null,
      locationAddress: remote.location,
      locationMapsUrl: null,
      locationLat: remote.geo?.lat ?? null,
      locationLon: remote.geo?.lon ?? null,
    });
  }

  try {
    const counts = await opts.store.reconcileFromApple({
      syncId,
      events: upserts,
    });
    const summary: AppleSyncSummary = {
      sync_id: syncId,
      ...counts,
      skipped,
      remote_count: fetched.data.events.length,
      errors: errors.slice(0, 20),
    };
    logger.info("[calendar] sync", {
      component: "calendar",
      handler: "tool",
      step: "finish",
      tool: "calendar_sync",
      result: "success",
      duration_ms: Date.now() - started,
      created: counts.created,
      updated: counts.updated,
      unchanged: counts.unchanged,
      deleted: counts.deleted,
      skipped,
      remote_count: summary.remote_count,
    });
    return { ok: true, data: summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorType = classifyError(err);
    recordVoiceError({ errorType, handler: "tool" });
    logger.exception("[calendar] sync reconcile failed", err, {
      component: "calendar",
      handler: "tool",
      step: "finish",
      tool: "calendar_sync",
      result: "error",
      duration_ms: Date.now() - started,
      error_type: errorType,
    });
    return { ok: false, error: message };
  }
}
