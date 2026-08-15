import { Prisma, type PrismaClient } from "@prisma/client";
import { formatLocal } from "../utils/time/index.js";
import type { EventPublic, EventRecord, NewEvent } from "./types.js";

type EventRow = {
  id: string;
  uid: string;
  href: string;
  title: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  notes: string | null;
  alarmMinutesBefore: Prisma.JsonValue;
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
    href: row.href,
    title: row.title,
    startAt: row.startAt,
    endAt: row.endAt,
    timezone: row.timezone,
    notes: row.notes,
    alarmMinutesBefore: parseAlarmMinutes(row.alarmMinutesBefore),
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
    title: r.title,
    start_iso: r.startAt.toISOString(),
    end_iso: r.endAt.toISOString(),
    start_local: formatLocal(r.startAt, r.timezone),
    end_local: formatLocal(r.endAt, r.timezone),
    timezone: r.timezone,
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

export class EventStore {
  constructor(private readonly db: PrismaClient) {}

  async create(input: NewEvent): Promise<EventRecord> {
    const row = await this.db.event.create({
      data: {
        uid: input.uid,
        href: input.href,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        timezone: input.timezone,
        notes: input.notes ?? null,
        alarmMinutesBefore:
          input.alarmMinutesBefore === undefined
            ? undefined
            : input.alarmMinutesBefore === null
              ? Prisma.DbNull
              : (input.alarmMinutesBefore as Prisma.InputJsonValue),
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
    const row = await this.db.event.findUnique({ where: { uid } });
    return row ? toRecord(row) : null;
  }

  async getByUids(uids: string[]): Promise<EventRecord[]> {
    const unique = [...new Set(uids.filter((u) => u.length > 0))];
    if (unique.length === 0) return [];
    const rows = await this.db.event.findMany({
      where: { uid: { in: unique } },
    });
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
            ? {
                alarmMinutesBefore:
                  patch.alarmMinutesBefore === null
                    ? Prisma.DbNull
                    : (patch.alarmMinutesBefore as Prisma.InputJsonValue),
              }
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
}
