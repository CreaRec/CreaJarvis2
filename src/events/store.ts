import { Prisma, type PrismaClient } from "@prisma/client";
import { formatLocal } from "../utils/time/index.js";
import type { EventPublic, EventRecord, NewEvent } from "./types.js";
import { normalizeRecurrenceId, publicRecurrenceId } from "./types.js";

type EventRow = {
  id: string;
  uid: string;
  recurrenceId: string;
  href: string;
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  notes: string | null;
  alarmMinutesBefore: Prisma.JsonValue;
  recurrenceRule: string | null;
  isAllDay: boolean;
  sourceUpdatedAt: Date | null;
  lastSeenSyncId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapsUrl: string | null;
  locationLat: number | null;
  locationLon: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseAlarmMinutes(value: unknown): number[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const mins = value.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return mins;
}

function toRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    uid: row.uid,
    recurrenceId: row.recurrenceId ?? "",
    href: row.href,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    timezone: row.timezone,
    notes: row.notes,
    alarmMinutesBefore: parseAlarmMinutes(row.alarmMinutesBefore),
    recurrenceRule: row.recurrenceRule ?? null,
    isAllDay: row.isAllDay ?? false,
    sourceUpdatedAt: row.sourceUpdatedAt ?? null,
    lastSeenSyncId: row.lastSeenSyncId ?? null,
    locationName: row.locationName ?? null,
    locationAddress: row.locationAddress ?? null,
    locationMapsUrl: row.locationMapsUrl ?? null,
    locationLat: row.locationLat ?? null,
    locationLon: row.locationLon ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPublic(r: EventRecord): EventPublic {
  return {
    id: r.id,
    event_uid: r.uid,
    recurrence_id: publicRecurrenceId(r.recurrenceId),
    title: r.title,
    start_iso: r.startAt.toISOString(),
    end_iso: r.endAt.toISOString(),
    start_local: formatLocal(r.startAt, r.timezone),
    end_local: formatLocal(r.endAt, r.timezone),
    timezone: r.timezone,
    is_all_day: r.isAllDay,
    recurrence_rule: r.recurrenceRule,
    notes: r.notes,
    alarm_minutes_before: r.alarmMinutesBefore,
    location_name: r.locationName,
    location_address: r.locationAddress,
    location_maps_url: r.locationMapsUrl,
    location_lat: r.locationLat,
    location_lon: r.locationLon,
    created_at: r.createdAt.toISOString(),
  };
}

export type EventUpsertInput = NewEvent & {
  lastSeenSyncId: string;
};

function jsonAlarms(
  value: number[] | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

export class EventStore {
  constructor(private readonly db: PrismaClient) {}

  async create(input: NewEvent): Promise<EventRecord> {
    const row = await this.db.event.create({
      data: {
        uid: input.uid,
        recurrenceId: normalizeRecurrenceId(input.recurrenceId),
        href: input.href,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        timezone: input.timezone,
        notes: input.notes ?? null,
        alarmMinutesBefore: jsonAlarms(input.alarmMinutesBefore),
        recurrenceRule: input.recurrenceRule ?? null,
        isAllDay: input.isAllDay ?? false,
        sourceUpdatedAt: input.sourceUpdatedAt ?? null,
        lastSeenSyncId: input.lastSeenSyncId ?? null,
        locationName: input.locationName ?? null,
        locationAddress: input.locationAddress ?? null,
        locationMapsUrl: input.locationMapsUrl ?? null,
        locationLat: input.locationLat ?? null,
        locationLon: input.locationLon ?? null,
      },
    });
    return toRecord(row);
  }

  async getById(id: string): Promise<EventRecord | null> {
    const row = await this.db.event.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async getByUid(uid: string): Promise<EventRecord | null> {
    const rows = await this.db.event.findMany({
      where: { uid },
      orderBy: { recurrenceId: "asc" },
      take: 2,
    });
    if (rows.length === 0) return null;
    if (rows.length > 1) return null; // ambiguous
    return toRecord(rows[0]!);
  }

  async getByUidAndRecurrence(
    uid: string,
    recurrenceId: string | null | undefined,
  ): Promise<EventRecord | null> {
    const row = await this.db.event.findUnique({
      where: {
        uid_recurrenceId: {
          uid,
          recurrenceId: normalizeRecurrenceId(recurrenceId),
        },
      },
    });
    return row ? toRecord(row) : null;
  }

  async listByUid(uid: string): Promise<EventRecord[]> {
    const rows = await this.db.event.findMany({ where: { uid } });
    return rows.map(toRecord);
  }

  async getByUids(uids: string[]): Promise<EventRecord[]> {
    const unique = [...new Set(uids.filter((u) => u.length > 0))];
    if (unique.length === 0) return [];
    const rows = await this.db.event.findMany({
      where: { uid: { in: unique } },
    });
    return rows.map(toRecord);
  }

  async listAll(): Promise<EventRecord[]> {
    const rows = await this.db.event.findMany({ orderBy: { startAt: "asc" } });
    return rows.map(toRecord);
  }

  async update(
    id: string,
    patch: {
      title?: string;
      startAt?: Date;
      endAt?: Date;
      notes?: string | null;
      alarmMinutesBefore?: number[] | null;
      href?: string;
      recurrenceRule?: string | null;
      isAllDay?: boolean;
      sourceUpdatedAt?: Date | null;
      lastSeenSyncId?: string | null;
      locationName?: string | null;
      locationAddress?: string | null;
      locationMapsUrl?: string | null;
      locationLat?: number | null;
      locationLon?: number | null;
    },
  ): Promise<EventRecord | null> {
    try {
      const row = await this.db.event.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
          ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.href !== undefined ? { href: patch.href } : {}),
          ...(patch.recurrenceRule !== undefined
            ? { recurrenceRule: patch.recurrenceRule }
            : {}),
          ...(patch.isAllDay !== undefined ? { isAllDay: patch.isAllDay } : {}),
          ...(patch.sourceUpdatedAt !== undefined
            ? { sourceUpdatedAt: patch.sourceUpdatedAt }
            : {}),
          ...(patch.lastSeenSyncId !== undefined
            ? { lastSeenSyncId: patch.lastSeenSyncId }
            : {}),
          ...(patch.locationName !== undefined
            ? { locationName: patch.locationName }
            : {}),
          ...(patch.locationAddress !== undefined
            ? { locationAddress: patch.locationAddress }
            : {}),
          ...(patch.locationMapsUrl !== undefined
            ? { locationMapsUrl: patch.locationMapsUrl }
            : {}),
          ...(patch.locationLat !== undefined
            ? { locationLat: patch.locationLat }
            : {}),
          ...(patch.locationLon !== undefined
            ? { locationLon: patch.locationLon }
            : {}),
          ...(patch.alarmMinutesBefore !== undefined
            ? { alarmMinutesBefore: jsonAlarms(patch.alarmMinutesBefore) }
            : {}),
        },
      });
      return toRecord(row);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<EventRecord | null> {
    try {
      const row = await this.db.event.delete({ where: { id } });
      return toRecord(row);
    } catch {
      return null;
    }
  }

  async list(opts: {
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<EventRecord[]> {
    const limit = opts.limit ?? 50;
    const rows = await this.db.event.findMany({
      where: {
        ...(opts.from || opts.to
          ? {
              startAt: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { startAt: "asc" },
      take: limit,
    });
    return rows.map(toRecord);
  }

  /**
   * Upsert Apple snapshot rows and delete locals not seen in this sync run.
   * Caller must only invoke after a complete Apple fetch.
   */
  async reconcileFromApple(opts: {
    syncId: string;
    events: EventUpsertInput[];
  }): Promise<{
    created: number;
    updated: number;
    unchanged: number;
    deleted: number;
  }> {
    return this.db.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      for (const input of opts.events) {
        const rid = normalizeRecurrenceId(input.recurrenceId);
        const existing = await tx.event.findUnique({
          where: { uid_recurrenceId: { uid: input.uid, recurrenceId: rid } },
        });
        if (!existing) {
          await tx.event.create({
            data: {
              uid: input.uid,
              recurrenceId: rid,
              href: input.href,
              title: input.title,
              startAt: input.startAt,
              endAt: input.endAt,
              timezone: input.timezone,
              notes: input.notes ?? null,
              alarmMinutesBefore: jsonAlarms(input.alarmMinutesBefore ?? null),
              recurrenceRule: input.recurrenceRule ?? null,
              isAllDay: input.isAllDay ?? false,
              sourceUpdatedAt: input.sourceUpdatedAt ?? null,
              lastSeenSyncId: opts.syncId,
              locationName: input.locationName ?? null,
              locationAddress: input.locationAddress ?? null,
              locationMapsUrl: input.locationMapsUrl ?? null,
              locationLat: input.locationLat ?? null,
              locationLon: input.locationLon ?? null,
            },
          });
          created += 1;
          continue;
        }

        const same =
          existing.title === input.title &&
          existing.href === input.href &&
          existing.startAt.getTime() === input.startAt.getTime() &&
          existing.endAt.getTime() === input.endAt.getTime() &&
          existing.timezone === input.timezone &&
          (existing.notes ?? null) === (input.notes ?? null) &&
          (existing.recurrenceRule ?? null) === (input.recurrenceRule ?? null) &&
          existing.isAllDay === (input.isAllDay ?? false) &&
          (existing.locationAddress ?? null) ===
            (input.locationAddress ?? null) &&
          JSON.stringify(existing.alarmMinutesBefore ?? null) ===
            JSON.stringify(input.alarmMinutesBefore ?? null);

        await tx.event.update({
          where: { id: existing.id },
          data: {
            href: input.href,
            title: input.title,
            startAt: input.startAt,
            endAt: input.endAt,
            timezone: input.timezone,
            notes: input.notes ?? null,
            alarmMinutesBefore: jsonAlarms(input.alarmMinutesBefore ?? null),
            recurrenceRule: input.recurrenceRule ?? null,
            isAllDay: input.isAllDay ?? false,
            sourceUpdatedAt: input.sourceUpdatedAt ?? null,
            lastSeenSyncId: opts.syncId,
            locationName: input.locationName ?? null,
            locationAddress: input.locationAddress ?? null,
            locationMapsUrl: input.locationMapsUrl ?? null,
            locationLat: input.locationLat ?? null,
            locationLon: input.locationLon ?? null,
          },
        });
        if (same) unchanged += 1;
        else updated += 1;
      }

      const deletedResult = await tx.event.deleteMany({
        where: {
          OR: [
            { lastSeenSyncId: null },
            { lastSeenSyncId: { not: opts.syncId } },
          ],
        },
      });

      return {
        created,
        updated,
        unchanged,
        deleted: deletedResult.count,
      };
    });
  }
}
