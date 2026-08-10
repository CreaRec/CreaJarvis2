import {
  Prisma,
  type PrismaClient,
  type ReminderStatus as PrismaStatus,
} from "@prisma/client";
import { logger } from "../log.js";
import type { Embedder } from "../memory/embedder.js";
import { formatLocal } from "../utils/time/index.js";
import { nextFireAt } from "./recurrence.js";
import type {
  NewReminder,
  Recurrence,
  ReminderPublic,
  ReminderRecord,
  ReminderStatus,
} from "./types.js";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function parseRecurrence(value: unknown): Recurrence | null {
  if (value == null) return null;
  if (typeof value !== "object") return null;
  return value as Recurrence;
}

type ReminderRow = {
  id: string;
  text: string;
  fireAt: Date;
  timezone: string;
  status: PrismaStatus;
  rawUtterance: string | null;
  recurrence: Prisma.JsonValue;
  quietHoursOverride: boolean | null;
  deliveredAt: Date | null;
  calendarUid: string | null;
  calendarHref: string | null;
  calendarEndAt: Date | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapsUrl: string | null;
  locationLat: number | null;
  locationLon: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    text: row.text,
    fireAt: row.fireAt,
    timezone: row.timezone,
    status: row.status as ReminderStatus,
    rawUtterance: row.rawUtterance,
    recurrence: parseRecurrence(row.recurrence),
    quietHoursOverride: row.quietHoursOverride,
    deliveredAt: row.deliveredAt,
    calendarUid: row.calendarUid ?? null,
    calendarHref: row.calendarHref ?? null,
    calendarEndAt: row.calendarEndAt ?? null,
    locationName: row.locationName ?? null,
    locationAddress: row.locationAddress ?? null,
    locationMapsUrl: row.locationMapsUrl ?? null,
    locationLat: row.locationLat ?? null,
    locationLon: row.locationLon ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPublic(r: ReminderRecord): ReminderPublic {
  return {
    id: r.id,
    text: r.text,
    fire_at_iso: r.fireAt.toISOString(),
    fire_at_local: formatLocal(r.fireAt, r.timezone),
    status: r.status,
    recurrence: r.recurrence,
    raw_utterance: r.rawUtterance,
    timezone: r.timezone,
    delivered_at: r.deliveredAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
    calendar_uid: r.calendarUid,
    has_calendar_event: Boolean(r.calendarUid),
    calendar_end_at_iso: r.calendarEndAt?.toISOString() ?? null,
    location_name: r.locationName,
    location_address: r.locationAddress,
    location_maps_url: r.locationMapsUrl,
  };
}

export class ReminderStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly embedder?: Embedder,
  ) {}

  async create(input: NewReminder): Promise<ReminderRecord> {
    const row = await this.db.reminder.create({
      data: {
        text: input.text,
        fireAt: input.fireAt,
        timezone: input.timezone,
        status: input.status ?? "pending",
        rawUtterance: input.rawUtterance ?? null,
        recurrence: (input.recurrence ??
          undefined) as Prisma.InputJsonValue | undefined,
        quietHoursOverride: input.quietHoursOverride ?? null,
        locationName: input.locationName ?? null,
        locationAddress: input.locationAddress ?? null,
        locationMapsUrl: input.locationMapsUrl ?? null,
        locationLat: input.locationLat ?? null,
        locationLon: input.locationLon ?? null,
      },
    });
    const record = toRecord(row);
    await this.index(record.id);
    return record;
  }

  async getById(id: string): Promise<ReminderRecord | null> {
    const row = await this.db.reminder.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async getByCalendarUid(uid: string): Promise<ReminderRecord | null> {
    const row = await this.db.reminder.findUnique({
      where: { calendarUid: uid },
    });
    return row ? toRecord(row) : null;
  }

  async getByCalendarUids(uids: string[]): Promise<ReminderRecord[]> {
    const unique = [...new Set(uids.filter((u) => u.length > 0))];
    if (unique.length === 0) return [];
    const rows = await this.db.reminder.findMany({
      where: { calendarUid: { in: unique } },
    });
    return rows.map(toRecord);
  }

  async getByIds(ids: string[]): Promise<ReminderRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.reminder.findMany({
      where: { id: { in: ids } },
    });
    const byId = new Map(rows.map((r) => [r.id, toRecord(r)]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is ReminderRecord => Boolean(r));
  }

  async setCalendarLink(
    id: string,
    link: { uid: string; href: string; endAt: Date },
  ): Promise<ReminderRecord | null> {
    try {
      const row = await this.db.reminder.update({
        where: { id },
        data: {
          calendarUid: link.uid,
          calendarHref: link.href,
          calendarEndAt: link.endAt,
        },
      });
      return toRecord(row);
    } catch {
      return null;
    }
  }

  async clearCalendarLink(id: string): Promise<ReminderRecord | null> {
    try {
      const row = await this.db.reminder.update({
        where: { id },
        data: {
          calendarUid: null,
          calendarHref: null,
          calendarEndAt: null,
        },
      });
      return toRecord(row);
    } catch {
      return null;
    }
  }

  async update(
    id: string,
    patch: {
      text?: string;
      fireAt?: Date;
      recurrence?: Recurrence | null;
      status?: ReminderStatus;
      quietHoursOverride?: boolean | null;
      deliveredAt?: Date | null;
      calendarEndAt?: Date | null;
      locationName?: string | null;
      locationAddress?: string | null;
      locationMapsUrl?: string | null;
      locationLat?: number | null;
      locationLon?: number | null;
    },
  ): Promise<ReminderRecord | null> {
    try {
      const row = await this.db.reminder.update({
        where: { id },
        data: {
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.fireAt !== undefined ? { fireAt: patch.fireAt } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.quietHoursOverride !== undefined
            ? { quietHoursOverride: patch.quietHoursOverride }
            : {}),
          ...(patch.deliveredAt !== undefined
            ? { deliveredAt: patch.deliveredAt }
            : {}),
          ...(patch.calendarEndAt !== undefined
            ? { calendarEndAt: patch.calendarEndAt }
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
          ...(patch.recurrence !== undefined
            ? {
                recurrence:
                  patch.recurrence === null
                    ? Prisma.DbNull
                    : (patch.recurrence as Prisma.InputJsonValue),
              }
            : {}),
        },
      });
      const record = toRecord(row);
      if (patch.text !== undefined) await this.index(record.id);
      return record;
    } catch {
      return null;
    }
  }

  async list(opts: {
    from?: Date;
    to?: Date;
    statuses?: ReminderStatus[];
    limit?: number;
  }): Promise<ReminderRecord[]> {
    const limit = opts.limit ?? 50;
    const rows = await this.db.reminder.findMany({
      where: {
        ...(opts.statuses?.length ? { status: { in: opts.statuses } } : {}),
        ...(opts.from || opts.to
          ? {
              fireAt: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { fireAt: "asc" },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async listForDebug(limit = 100): Promise<ReminderRecord[]> {
    const active = await this.db.reminder.findMany({
      where: {
        status: { in: ["pending", "delivering", "missed", "snoozed"] },
      },
      orderBy: { fireAt: "asc" },
      take: limit,
    });
    const remaining = Math.max(0, limit - active.length);
    const recent =
      remaining > 0
        ? await this.db.reminder.findMany({
            where: {
              status: { in: ["delivered", "cancelled"] },
            },
            orderBy: { updatedAt: "desc" },
            take: remaining,
          })
        : [];
    return [...active.map(toRecord), ...recent.map(toRecord)];
  }

  async cancel(id: string): Promise<ReminderRecord | null> {
    return this.update(id, { status: "cancelled" });
  }

  async cancelMany(opts: {
    scope: "today" | "all_pending" | "range";
    from?: Date;
    to?: Date;
    todayStart?: Date;
    todayEnd?: Date;
  }): Promise<number> {
    const where: Prisma.ReminderWhereInput = {
      status: { in: ["pending", "snoozed", "missed", "delivering"] },
    };
    if (opts.scope === "today" && opts.todayStart && opts.todayEnd) {
      where.fireAt = { gte: opts.todayStart, lt: opts.todayEnd };
    } else if (opts.scope === "range") {
      where.fireAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      };
    }
    const result = await this.db.reminder.updateMany({
      where,
      data: { status: "cancelled" },
    });
    return result.count;
  }

  /** Reminders that would be cancelled by cancelMany (for calendar sync). */
  async listForCancelMany(opts: {
    scope: "today" | "all_pending" | "range";
    from?: Date;
    to?: Date;
    todayStart?: Date;
    todayEnd?: Date;
  }): Promise<ReminderRecord[]> {
    const where: Prisma.ReminderWhereInput = {
      status: { in: ["pending", "snoozed", "missed", "delivering"] },
    };
    if (opts.scope === "today" && opts.todayStart && opts.todayEnd) {
      where.fireAt = { gte: opts.todayStart, lt: opts.todayEnd };
    } else if (opts.scope === "range") {
      where.fireAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      };
    }
    const rows = await this.db.reminder.findMany({ where });
    return rows.map(toRecord);
  }

  async keywordSearch(query: string, limit: number): Promise<ReminderRecord[]> {
    const tokens = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1)
      .slice(0, 8);

    const statusFilter: ReminderStatus[] = [
      "pending",
      "snoozed",
      "missed",
      "delivering",
    ];

    if (tokens.length === 0) {
      return this.list({ statuses: statusFilter, limit });
    }

    const rows = await this.db.reminder.findMany({
      where: {
        status: { in: statusFilter },
        OR: tokens.flatMap((t) => [
          { text: { contains: t, mode: "insensitive" as const } },
          { rawUtterance: { contains: t, mode: "insensitive" as const } },
        ]),
      },
      orderBy: { fireAt: "asc" },
      take: limit * 3,
    });

    const scored = rows.map((row) => {
      const hay = `${row.text} ${row.rawUtterance ?? ""}`.toLowerCase();
      const score = tokens.reduce(
        (acc, t) => acc + (hay.includes(t) ? 1 : 0),
        0,
      );
      return { record: toRecord(row), score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.record);
  }

  async search(query: string, limit: number): Promise<ReminderRecord[]> {
    if (this.embedder) {
      try {
        const embedding = await this.embedder.embed(query);
        const literal = toVectorLiteral(embedding);
        const rows = await this.db.$queryRawUnsafe<
          Array<{ id: string; score: number }>
        >(
          `SELECT "id"::text AS id, 1 - ("embedding" <=> $1::vector) AS score
           FROM "reminders"
           WHERE "embedding" IS NOT NULL
             AND status IN ('pending', 'snoozed', 'missed', 'delivering')
           ORDER BY "embedding" <=> $1::vector
           LIMIT $2`,
          literal,
          limit,
        );
        if (rows.length > 0) {
          return this.getByIds(rows.map((r) => r.id));
        }
      } catch (err) {
        logger.warn("[reminders] vector search failed, keyword fallback", {
          component: "reminders",
          handler: "tool",
          step: "search",
          error_message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return this.keywordSearch(query, limit);
  }

  async index(id: string): Promise<void> {
    if (!this.embedder) return;
    const record = await this.getById(id);
    if (!record) return;
    const embedding = await this.embedder.embed(
      `${record.text}\n${record.rawUtterance ?? ""}`.trim(),
    );
    await this.updateEmbedding(id, embedding);
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    const literal = toVectorLiteral(embedding);
    await this.db.$executeRawUnsafe(
      `UPDATE "reminders" SET "embedding" = $1::vector WHERE "id" = $2::uuid`,
      literal,
      id,
    );
  }

  async claimDue(now: Date, limit = 20): Promise<ReminderRecord[]> {
    // Do NOT RETURNING * — Prisma cannot deserialize Unsupported("vector").
    // Also re-claim stuck `delivering` rows (e.g. after a failed RETURNING).
    const rows = await this.db.$queryRawUnsafe<ReminderRow[]>(
      `UPDATE "reminders"
       SET status = 'delivering', "updatedAt" = NOW()
       WHERE id IN (
         SELECT id FROM "reminders"
         WHERE (
             (status IN ('pending', 'snoozed') AND "fireAt" <= $1)
             OR (status = 'delivering' AND "fireAt" <= $1)
           )
         ORDER BY "fireAt" ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING
         id, text, "fireAt", timezone, status, "rawUtterance",
         recurrence, "quietHoursOverride", "deliveredAt",
         "calendarUid", "calendarHref", "calendarEndAt",
         "createdAt", "updatedAt"`,
      now,
      limit,
    );
    return rows.map(toRecord);
  }

  async markMissed(id: string): Promise<ReminderRecord | null> {
    return this.update(id, { status: "missed" });
  }

  async listMissed(limit = 50): Promise<ReminderRecord[]> {
    return this.list({ statuses: ["missed"], limit });
  }

  async completeDelivery(id: string): Promise<ReminderRecord | null> {
    const current = await this.getById(id);
    if (!current) return null;

    if (current.recurrence) {
      const next = nextFireAt(
        current.fireAt,
        current.recurrence,
        current.timezone,
      );
      if (next) {
        return this.update(id, {
          fireAt: next,
          status: "pending",
          deliveredAt: new Date(),
        });
      }
    }

    return this.update(id, {
      status: "delivered",
      deliveredAt: new Date(),
    });
  }

  async requeue(id: string, status: ReminderStatus = "pending"): Promise<void> {
    await this.update(id, { status });
  }
}
