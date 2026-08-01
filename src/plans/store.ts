import {
  Prisma,
  type PrismaClient,
  type PlanItemStatus as PrismaPlanItemStatus,
} from "@prisma/client";
import type { Embedder } from "../memory/embedder.js";
import {
  addLocalDateDays,
  formatLocal,
  localDateString,
  todayLocalDate,
} from "../utils/time/index.js";
import { nextFireAt } from "../reminders/recurrence.js";
import type { ReminderStore } from "../reminders/store.js";
import type { Recurrence } from "../reminders/types.js";
import type {
  DayPlanPublic,
  DayPlanRecord,
  NewPlanItemInput,
  PlanItemPublic,
  PlanItemRecord,
  PlanItemStatus,
} from "./types.js";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function parseRecurrence(value: unknown): Recurrence | null {
  if (value == null || typeof value !== "object") return null;
  return value as Recurrence;
}

function toItem(
  row: {
    id: string;
    planId: string;
    text: string;
    status: PrismaPlanItemStatus;
    sortOrder: number;
    scheduledAt: Date | null;
    reminderId: string | null;
    recurrence: Prisma.JsonValue;
    rawUtterance: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  localDate: string,
  timezone: string,
): PlanItemRecord {
  return {
    id: row.id,
    planId: row.planId,
    localDate,
    text: row.text,
    status: row.status as PlanItemStatus,
    sortOrder: row.sortOrder,
    scheduledAt: row.scheduledAt,
    reminderId: row.reminderId,
    recurrence: parseRecurrence(row.recurrence),
    rawUtterance: row.rawUtterance,
    timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toItemPublic(item: PlanItemRecord): PlanItemPublic {
  return {
    id: item.id,
    text: item.text,
    status: item.status,
    sort_order: item.sortOrder,
    scheduled_at_iso: item.scheduledAt?.toISOString() ?? null,
    scheduled_at_local: item.scheduledAt
      ? formatLocal(item.scheduledAt, item.timezone)
      : null,
    has_reminder: Boolean(item.reminderId),
    reminder_id: item.reminderId,
    recurrence: item.recurrence,
    raw_utterance: item.rawUtterance,
  };
}

export function toDayPublic(plan: DayPlanRecord): DayPlanPublic {
  return {
    date: plan.localDate,
    timezone: plan.timezone,
    items: plan.items.map(toItemPublic),
  };
}

function wantsReminder(input: NewPlanItemInput): boolean {
  if (input.remind === false) return false;
  if (input.scheduledAt) return true;
  return input.remind === true;
}

export { wantsReminder };

export class PlanStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly reminders: ReminderStore,
    private readonly timezone: string,
    private readonly embedder?: Embedder,
  ) {}

  async getOrCreateDay(localDate: string): Promise<{
    id: string;
    localDate: string;
    timezone: string;
  }> {
    const existing = await this.db.dayPlan.findUnique({
      where: { localDate },
    });
    if (existing) {
      return {
        id: existing.id,
        localDate: existing.localDate,
        timezone: existing.timezone,
      };
    }
    const created = await this.db.dayPlan.create({
      data: { localDate, timezone: this.timezone },
    });
    return {
      id: created.id,
      localDate: created.localDate,
      timezone: created.timezone,
    };
  }

  async getDay(localDate: string): Promise<DayPlanRecord | null> {
    const row = await this.db.dayPlan.findUnique({
      where: { localDate },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    if (!row) return null;
    return {
      id: row.id,
      localDate: row.localDate,
      timezone: row.timezone,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items: row.items.map((i) => toItem(i, row.localDate, row.timezone)),
    };
  }

  async getOrEmpty(localDate: string): Promise<DayPlanRecord> {
    const day = await this.getDay(localDate);
    if (day) return day;
    const stub = await this.getOrCreateDay(localDate);
    return {
      id: stub.id,
      localDate: stub.localDate,
      timezone: stub.timezone,
      items: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async listRange(fromDate: string, toDate: string): Promise<DayPlanRecord[]> {
    const rows = await this.db.dayPlan.findMany({
      where: { localDate: { gte: fromDate, lte: toDate } },
      include: {
        items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: { localDate: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      localDate: row.localDate,
      timezone: row.timezone,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items: row.items.map((i) => toItem(i, row.localDate, row.timezone)),
    }));
  }

  async listOpenToday(now = new Date()): Promise<DayPlanRecord> {
    const date = todayLocalDate(this.timezone, now);
    return this.getOrEmpty(date);
  }

  private async nextSortOrder(planId: string): Promise<number> {
    const agg = await this.db.planItem.aggregate({
      where: { planId },
      _max: { sortOrder: true },
    });
    return (agg._max.sortOrder ?? -1) + 1;
  }

  private async createLinkedReminder(
    text: string,
    fireAt: Date,
    rawUtterance: string | null,
    recurrence: Recurrence | null,
  ): Promise<string> {
    const reminder = await this.reminders.create({
      text,
      fireAt,
      timezone: this.timezone,
      rawUtterance,
      recurrence,
    });
    return reminder.id;
  }

  private async cancelLinkedReminder(reminderId: string | null): Promise<void> {
    if (!reminderId) return;
    await this.reminders.cancel(reminderId);
  }

  async addItems(
    localDate: string,
    inputs: NewPlanItemInput[],
  ): Promise<DayPlanRecord> {
    const day = await this.getOrCreateDay(localDate);
    let sort = await this.nextSortOrder(day.id);
    for (const input of inputs) {
      let reminderId: string | null = null;
      if (wantsReminder(input) && input.scheduledAt) {
        reminderId = await this.createLinkedReminder(
          input.text,
          input.scheduledAt,
          input.rawUtterance ?? null,
          input.recurrence ?? null,
        );
      }
      const created = await this.db.planItem.create({
        data: {
          planId: day.id,
          text: input.text,
          sortOrder: input.sortOrder ?? sort,
          scheduledAt: input.scheduledAt ?? null,
          reminderId,
          rawUtterance: input.rawUtterance ?? null,
          recurrence: (input.recurrence ??
            undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      sort = Math.max(sort, created.sortOrder) + 1;
      await this.indexItem(created.id, input.text, input.rawUtterance ?? null);
    }
    return (await this.getDay(localDate))!;
  }

  async setDay(
    localDate: string,
    inputs: NewPlanItemInput[],
  ): Promise<DayPlanRecord> {
    const existing = await this.getDay(localDate);
    if (existing) {
      for (const item of existing.items) {
        await this.cancelLinkedReminder(item.reminderId);
      }
      await this.db.planItem.deleteMany({ where: { planId: existing.id } });
    }
    return this.addItems(localDate, inputs);
  }

  async getItem(id: string): Promise<PlanItemRecord | null> {
    const row = await this.db.planItem.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!row) return null;
    return toItem(row, row.plan.localDate, row.plan.timezone);
  }

  async updateItem(
    id: string,
    patch: {
      text?: string;
      scheduledAt?: Date | null;
      status?: PlanItemStatus;
      sortOrder?: number;
      recurrence?: Recurrence | null;
    },
  ): Promise<PlanItemRecord | null> {
    const current = await this.getItem(id);
    if (!current) return null;

    let reminderId = current.reminderId;
    const nextText = patch.text ?? current.text;
    const nextScheduled =
      patch.scheduledAt !== undefined ? patch.scheduledAt : current.scheduledAt;
    const nextStatus = patch.status ?? current.status;

    if (nextStatus === "cancelled" || nextStatus === "done") {
      await this.cancelLinkedReminder(reminderId);
      reminderId = null;
    } else if (nextScheduled) {
      if (reminderId) {
        await this.reminders.update(reminderId, {
          text: nextText,
          fireAt: nextScheduled,
          status: "pending",
        });
      } else {
        reminderId = await this.createLinkedReminder(
          nextText,
          nextScheduled,
          current.rawUtterance,
          patch.recurrence !== undefined
            ? patch.recurrence
            : current.recurrence,
        );
      }
    } else if (patch.scheduledAt === null && reminderId) {
      await this.cancelLinkedReminder(reminderId);
      reminderId = null;
    }

    await this.db.planItem.update({
      where: { id },
      data: {
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.scheduledAt !== undefined
          ? { scheduledAt: patch.scheduledAt }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.recurrence !== undefined
          ? {
              recurrence:
                patch.recurrence === null
                  ? Prisma.DbNull
                  : (patch.recurrence as Prisma.InputJsonValue),
            }
          : {}),
        reminderId,
      },
    });

    if (patch.text !== undefined) {
      await this.indexItem(id, nextText, current.rawUtterance);
    }

    if (nextStatus === "done" && current.recurrence) {
      await this.advanceRecurrence(current);
    }

    return this.getItem(id);
  }

  private async advanceRecurrence(current: PlanItemRecord): Promise<void> {
    if (!current.recurrence) return;
    const anchor =
      current.scheduledAt ??
      new Date(
        `${current.localDate}T12:00:00.000Z`,
      );
    const nextAt = nextFireAt(anchor, current.recurrence, current.timezone);
    if (!nextAt) return;
    const nextDate = localDateString(nextAt, current.timezone);
    await this.addItems(nextDate, [
      {
        text: current.text,
        scheduledAt: current.scheduledAt ? nextAt : null,
        remind: Boolean(current.scheduledAt),
        recurrence: current.recurrence,
        rawUtterance: current.rawUtterance,
      },
    ]);
  }

  async completeItem(id: string): Promise<PlanItemRecord | null> {
    return this.updateItem(id, { status: "done" });
  }

  async cancelItem(id: string): Promise<PlanItemRecord | null> {
    return this.updateItem(id, { status: "cancelled" });
  }

  async moveItem(
    id: string,
    toDate: string,
    scheduledAt?: Date | null,
  ): Promise<PlanItemRecord | null> {
    const current = await this.getItem(id);
    if (!current) return null;
    const target = await this.getOrCreateDay(toDate);
    const sortOrder = await this.nextSortOrder(target.id);
    const nextScheduled =
      scheduledAt !== undefined ? scheduledAt : current.scheduledAt;

    let reminderId = current.reminderId;
    if (nextScheduled) {
      if (reminderId) {
        await this.reminders.update(reminderId, {
          fireAt: nextScheduled,
          status: "pending",
        });
      } else {
        reminderId = await this.createLinkedReminder(
          current.text,
          nextScheduled,
          current.rawUtterance,
          current.recurrence,
        );
      }
    }

    await this.db.planItem.update({
      where: { id },
      data: {
        planId: target.id,
        sortOrder,
        scheduledAt: nextScheduled,
        reminderId,
        status: "open",
      },
    });
    return this.getItem(id);
  }

  async carryOver(fromDate: string, toDate: string): Promise<DayPlanRecord> {
    const from = await this.getDay(fromDate);
    if (!from) return this.getOrEmpty(toDate);
    const open = from.items.filter((i) => i.status === "open");
    for (const item of open) {
      await this.moveItem(item.id, toDate);
    }
    return (await this.getDay(toDate)) ?? (await this.getOrEmpty(toDate));
  }

  async clearDay(
    localDate: string,
    onlyOpen = true,
  ): Promise<DayPlanRecord> {
    const day = await this.getDay(localDate);
    if (!day) return this.getOrEmpty(localDate);
    for (const item of day.items) {
      if (onlyOpen && item.status !== "open") continue;
      await this.cancelItem(item.id);
    }
    return (await this.getDay(localDate))!;
  }

  async search(query: string, limit = 10): Promise<PlanItemRecord[]> {
    if (this.embedder) {
      try {
        const embedding = await this.embedder.embed(query);
        const literal = toVectorLiteral(embedding);
        const rows = await this.db.$queryRawUnsafe<
          Array<{ id: string }>
        >(
          `SELECT "id"::text AS id
           FROM "plan_items"
           WHERE "embedding" IS NOT NULL
             AND status IN ('open', 'done')
           ORDER BY "embedding" <=> $1::vector
           LIMIT $2`,
          literal,
          limit,
        );
        if (rows.length > 0) {
          const items = await Promise.all(rows.map((r) => this.getItem(r.id)));
          return items.filter((i): i is PlanItemRecord => Boolean(i));
        }
      } catch (err) {
        console.warn("[plans] vector search failed, keyword fallback:", err);
      }
    }
    return this.keywordSearch(query, limit);
  }

  async keywordSearch(query: string, limit: number): Promise<PlanItemRecord[]> {
    const tokens = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1)
      .slice(0, 8);

    const rows = await this.db.planItem.findMany({
      where: {
        status: { in: ["open", "done"] },
        ...(tokens.length
          ? {
              OR: tokens.flatMap((t) => [
                { text: { contains: t, mode: "insensitive" as const } },
                { rawUtterance: { contains: t, mode: "insensitive" as const } },
              ]),
            }
          : {}),
      },
      include: { plan: true },
      orderBy: { updatedAt: "desc" },
      take: limit * 3,
    });

    const scored = rows.map((row) => {
      const hay = `${row.text} ${row.rawUtterance ?? ""}`.toLowerCase();
      const score =
        tokens.length === 0
          ? 1
          : tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
      return {
        item: toItem(row, row.plan.localDate, row.plan.timezone),
        score,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.item);
  }

  async listForDebug(limit = 100): Promise<PlanItemRecord[]> {
    const today = todayLocalDate(this.timezone);
    const from = addLocalDateDays(today, this.timezone, -3);
    const to = addLocalDateDays(today, this.timezone, 7);
    const plans = await this.listRange(from, to);
    const items = plans.flatMap((p) => p.items);
    return items.slice(0, limit);
  }

  private async indexItem(
    id: string,
    text: string,
    rawUtterance: string | null,
  ): Promise<void> {
    if (!this.embedder) return;
    const embedding = await this.embedder.embed(
      `${text}\n${rawUtterance ?? ""}`.trim(),
    );
    await this.db.$executeRawUnsafe(
      `UPDATE "plan_items" SET "embedding" = $1::vector WHERE "id" = $2::uuid`,
      toVectorLiteral(embedding),
      id,
    );
  }
}
