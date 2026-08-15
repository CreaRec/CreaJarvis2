import {
  Prisma,
  type PrismaClient,
  type ReminderAppleSyncStatus as PrismaAppleSyncStatus,
} from "@prisma/client";
import { logger } from "../log.js";
import type { Embedder } from "../memory/embedder.js";
import { formatLocal } from "../utils/time/index.js";
import type {
  NewReminder,
  Recurrence,
  ReminderAppleSyncStatus,
  ReminderPublic,
  ReminderRecord,
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
  rawUtterance: string | null;
  recurrence: Prisma.JsonValue;
  appleSyncStatus: PrismaAppleSyncStatus;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: ReminderRow): ReminderRecord {
  return {
    id: row.id,
    text: row.text,
    fireAt: row.fireAt,
    timezone: row.timezone,
    rawUtterance: row.rawUtterance,
    recurrence: parseRecurrence(row.recurrence),
    appleSyncStatus: row.appleSyncStatus as ReminderAppleSyncStatus,
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
    recurrence: r.recurrence,
    raw_utterance: r.rawUtterance,
    timezone: r.timezone,
    created_at: r.createdAt.toISOString(),
    apple_sync_status: r.appleSyncStatus,
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
        rawUtterance: input.rawUtterance ?? null,
        recurrence: (input.recurrence ??
          undefined) as Prisma.InputJsonValue | undefined,
        appleSyncStatus: input.appleSyncStatus ?? "pending",
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

  async update(
    id: string,
    patch: {
      text?: string;
      fireAt?: Date;
      recurrence?: Recurrence | null;
      appleSyncStatus?: ReminderAppleSyncStatus;
    },
  ): Promise<ReminderRecord | null> {
    try {
      const row = await this.db.reminder.update({
        where: { id },
        data: {
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.fireAt !== undefined ? { fireAt: patch.fireAt } : {}),
          ...(patch.appleSyncStatus !== undefined
            ? { appleSyncStatus: patch.appleSyncStatus }
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
    limit?: number;
  }): Promise<ReminderRecord[]> {
    const limit = opts.limit ?? 50;
    const rows = await this.db.reminder.findMany({
      where: {
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
    const rows = await this.db.reminder.findMany({
      orderBy: { fireAt: "asc" },
      take: limit,
    });
    return rows.map(toRecord);
  }

  async cancel(id: string): Promise<ReminderRecord | null> {
    try {
      const row = await this.db.reminder.delete({ where: { id } });
      return toRecord(row);
    } catch {
      return null;
    }
  }

  async cancelMany(opts: {
    scope: "today" | "all_pending" | "range";
    from?: Date;
    to?: Date;
    todayStart?: Date;
    todayEnd?: Date;
  }): Promise<number> {
    const where: Prisma.ReminderWhereInput = {};
    if (opts.scope === "today" && opts.todayStart && opts.todayEnd) {
      where.fireAt = { gte: opts.todayStart, lt: opts.todayEnd };
    } else if (opts.scope === "range") {
      where.fireAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      };
    }
    const result = await this.db.reminder.deleteMany({ where });
    return result.count;
  }

  async keywordSearch(query: string, limit: number): Promise<ReminderRecord[]> {
    const tokens = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1)
      .slice(0, 8);

    if (tokens.length === 0) {
      return this.list({ limit });
    }

    const rows = await this.db.reminder.findMany({
      where: {
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
}
