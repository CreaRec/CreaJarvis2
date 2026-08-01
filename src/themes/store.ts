import {
  Prisma,
  type PrismaClient,
  type ThemeEntryKind as PrismaEntryKind,
  type ThemeEntryStatus as PrismaEntryStatus,
  type ThemeKind as PrismaThemeKind,
  type ThemeStatus as PrismaThemeStatus,
} from "@prisma/client";
import type { Embedder } from "../memory/embedder.js";
import type {
  NewThemeInput,
  ThemeDebugRow,
  ThemeEntryKind,
  ThemeEntryPublic,
  ThemeEntryRecord,
  ThemeEntryStatus,
  ThemeKind,
  ThemePublic,
  ThemeRecord,
  ThemeStatus,
} from "./types.js";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function parseMeta(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toEntry(row: {
  id: string;
  themeId: string;
  kind: PrismaEntryKind;
  status: PrismaEntryStatus;
  text: string;
  rawUtterance: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ThemeEntryRecord {
  return {
    id: row.id,
    themeId: row.themeId,
    kind: row.kind as ThemeEntryKind,
    status: row.status as ThemeEntryStatus,
    text: row.text,
    rawUtterance: row.rawUtterance,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTheme(row: {
  id: string;
  kind: PrismaThemeKind;
  title: string;
  status: PrismaThemeStatus;
  summary: string | null;
  meta: Prisma.JsonValue;
  rawUtterance: string | null;
  lastTouchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  entries?: Array<{
    id: string;
    themeId: string;
    kind: PrismaEntryKind;
    status: PrismaEntryStatus;
    text: string;
    rawUtterance: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): ThemeRecord {
  return {
    id: row.id,
    kind: row.kind as ThemeKind,
    title: row.title,
    status: row.status as ThemeStatus,
    summary: row.summary,
    meta: parseMeta(row.meta),
    rawUtterance: row.rawUtterance,
    lastTouchedAt: row.lastTouchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    entries: (row.entries ?? []).map(toEntry),
  };
}

export function toEntryPublic(e: ThemeEntryRecord): ThemeEntryPublic {
  return {
    id: e.id,
    kind: e.kind,
    status: e.status,
    text: e.text,
    raw_utterance: e.rawUtterance,
    created_at: e.createdAt.toISOString(),
  };
}

export function toThemePublic(t: ThemeRecord): ThemePublic {
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    status: t.status,
    summary: t.summary,
    meta: t.meta,
    raw_utterance: t.rawUtterance,
    last_touched_at: t.lastTouchedAt.toISOString(),
    created_at: t.createdAt.toISOString(),
    entries: t.entries.map(toEntryPublic),
  };
}

export class ThemeStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly embedder?: Embedder,
  ) {}

  async create(input: NewThemeInput): Promise<ThemeRecord> {
    const now = new Date();
    const row = await this.db.theme.create({
      data: {
        kind: input.kind,
        title: input.title,
        summary: input.summary ?? null,
        meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        rawUtterance: input.rawUtterance ?? null,
        lastTouchedAt: now,
        ...(input.firstEntry
          ? {
              entries: {
                create: {
                  text: input.firstEntry.text,
                  kind: input.firstEntry.kind ?? "note",
                  rawUtterance: input.firstEntry.rawUtterance ?? null,
                },
              },
            }
          : {}),
      },
      include: {
        entries: { orderBy: { createdAt: "asc" } },
      },
    });
    const theme = toTheme(row);
    await this.indexTheme(theme.id);
    if (theme.entries[0]) {
      await this.indexEntry(theme.entries[0].id);
    }
    return theme;
  }

  async getById(id: string, entryLimit = 50): Promise<ThemeRecord | null> {
    const row = await this.db.theme.findUnique({
      where: { id },
      include: {
        entries: {
          orderBy: { createdAt: "desc" },
          take: entryLimit,
        },
      },
    });
    if (!row) return null;
    const theme = toTheme(row);
    theme.entries.reverse();
    return theme;
  }

  async list(opts: {
    kind?: ThemeKind;
    status?: ThemeStatus | ThemeStatus[];
    limit?: number;
  }): Promise<ThemeRecord[]> {
    const statuses = opts.status
      ? Array.isArray(opts.status)
        ? opts.status
        : [opts.status]
      : (["active"] as ThemeStatus[]);
    const rows = await this.db.theme.findMany({
      where: {
        status: { in: statuses },
        ...(opts.kind ? { kind: opts.kind } : {}),
      },
      orderBy: { lastTouchedAt: "desc" },
      take: opts.limit ?? 20,
      include: {
        entries: { orderBy: { createdAt: "desc" }, take: 3 },
      },
    });
    return rows.map((r) => {
      const t = toTheme(r);
      t.entries.reverse();
      return t;
    });
  }

  async addEntry(input: {
    themeId: string;
    text: string;
    kind?: ThemeEntryKind;
    rawUtterance?: string | null;
  }): Promise<ThemeRecord | null> {
    return this.addEntries(input.themeId, [
      {
        text: input.text,
        kind: input.kind ?? "note",
        rawUtterance: input.rawUtterance,
      },
    ]);
  }

  async addEntries(
    themeId: string,
    items: Array<{
      text: string;
      kind?: ThemeEntryKind;
      rawUtterance?: string | null;
    }>,
  ): Promise<ThemeRecord | null> {
    if (items.length === 0) return this.getById(themeId);

    const exists = await this.db.theme.findUnique({ where: { id: themeId } });
    if (!exists) return null;

    const created = await Promise.all(
      items.map((item) =>
        this.db.themeEntry.create({
          data: {
            themeId,
            text: item.text,
            kind: item.kind ?? "note",
            rawUtterance: item.rawUtterance ?? null,
          },
        }),
      ),
    );
    await this.db.theme.update({
      where: { id: themeId },
      data: { lastTouchedAt: new Date() },
    });
    for (const entry of created) {
      await this.indexEntry(entry.id);
    }
    await this.indexTheme(themeId);
    return this.getById(themeId);
  }

  async updateTheme(
    id: string,
    patch: {
      title?: string;
      summary?: string | null;
      status?: ThemeStatus;
      meta?: Record<string, unknown> | null;
      kind?: ThemeKind;
    },
  ): Promise<ThemeRecord | null> {
    try {
      await this.db.theme.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.meta !== undefined
            ? {
                meta:
                  patch.meta === null
                    ? Prisma.DbNull
                    : (patch.meta as Prisma.InputJsonValue),
              }
            : {}),
          lastTouchedAt: new Date(),
        },
      });
      if (patch.title !== undefined || patch.summary !== undefined) {
        await this.indexTheme(id);
      }
      return this.getById(id);
    } catch {
      return null;
    }
  }

  async updateEntry(
    id: string,
    patch: {
      text?: string;
      status?: ThemeEntryStatus;
      kind?: ThemeEntryKind;
    },
  ): Promise<ThemeEntryRecord | null> {
    try {
      const row = await this.db.themeEntry.update({
        where: { id },
        data: {
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        },
      });
      await this.db.theme.update({
        where: { id: row.themeId },
        data: { lastTouchedAt: new Date() },
      });
      if (patch.text !== undefined) await this.indexEntry(id);
      return toEntry(row);
    } catch {
      return null;
    }
  }

  async promote(
    id: string,
    title?: string,
  ): Promise<ThemeRecord | null> {
    const current = await this.getById(id);
    if (!current) return null;
    if (current.kind !== "idea") {
      return current;
    }
    return this.updateTheme(id, {
      kind: "project",
      ...(title ? { title } : {}),
    });
  }

  async archive(id: string): Promise<ThemeRecord | null> {
    return this.updateTheme(id, { status: "archived" });
  }

  async keywordSearch(
    query: string,
    opts: { kind?: ThemeKind; limit?: number } = {},
  ): Promise<ThemeRecord[]> {
    const limit = opts.limit ?? 10;
    const tokens = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1)
      .slice(0, 8);

    const rows = await this.db.theme.findMany({
      where: {
        status: { in: ["active", "on_hold", "done"] },
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(tokens.length
          ? {
              OR: [
                ...tokens.flatMap((t) => [
                  { title: { contains: t, mode: "insensitive" as const } },
                  { summary: { contains: t, mode: "insensitive" as const } },
                ]),
                {
                  entries: {
                    some: {
                      OR: tokens.flatMap((t) => [
                        {
                          text: {
                            contains: t,
                            mode: "insensitive" as const,
                          },
                        },
                        {
                          rawUtterance: {
                            contains: t,
                            mode: "insensitive" as const,
                          },
                        },
                      ]),
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { lastTouchedAt: "desc" },
      take: limit * 2,
      include: {
        entries: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    const scored = rows.map((row) => {
      const hay = `${row.title} ${row.summary ?? ""} ${row.entries
        .map((e) => e.text)
        .join(" ")}`.toLowerCase();
      const score =
        tokens.length === 0
          ? 1
          : tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
      const t = toTheme(row);
      t.entries.reverse();
      return { theme: t, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.theme);
  }

  async search(
    query: string,
    opts: { kind?: ThemeKind; limit?: number } = {},
  ): Promise<ThemeRecord[]> {
    const limit = opts.limit ?? 10;
    if (this.embedder) {
      try {
        const embedding = await this.embedder.embed(query);
        const literal = toVectorLiteral(embedding);
        const themeHits = await this.db.$queryRawUnsafe<
          Array<{ id: string }>
        >(
          `SELECT "id"::text AS id
           FROM "themes"
           WHERE "embedding" IS NOT NULL
             AND status IN ('active', 'on_hold', 'done')
             ${opts.kind ? `AND kind = '${opts.kind}'::"ThemeKind"` : ""}
           ORDER BY "embedding" <=> $1::vector
           LIMIT $2`,
          literal,
          limit,
        );
        const entryHits = await this.db.$queryRawUnsafe<
          Array<{ themeId: string }>
        >(
          `SELECT "themeId"::text AS "themeId"
           FROM "theme_entries"
           WHERE "embedding" IS NOT NULL
           ORDER BY "embedding" <=> $1::vector
           LIMIT $2`,
          literal,
          limit * 2,
        );
        const ids = [
          ...new Set([
            ...themeHits.map((h) => h.id),
            ...entryHits.map((h) => h.themeId),
          ]),
        ].slice(0, limit);
        if (ids.length > 0) {
          const themes = await Promise.all(ids.map((id) => this.getById(id)));
          return themes.filter((t): t is ThemeRecord => Boolean(t));
        }
      } catch (err) {
        console.warn("[themes] vector search failed, keyword fallback:", err);
      }
    }
    return this.keywordSearch(query, opts);
  }

  async listForDebug(limit = 100): Promise<ThemeDebugRow[]> {
    const themes = await this.db.theme.findMany({
      orderBy: { lastTouchedAt: "desc" },
      take: 40,
      include: {
        entries: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    const rows: ThemeDebugRow[] = [];
    for (const t of themes) {
      if (t.entries.length === 0) {
        rows.push({
          kind: t.kind as ThemeKind,
          status: t.status as ThemeStatus,
          title: t.title,
          entry_text: null,
          entry_kind: null,
          entry_status: null,
          id: t.id,
          entry_id: null,
          last_touched_at: t.lastTouchedAt.toISOString(),
        });
      } else {
        for (const e of t.entries) {
          rows.push({
            kind: t.kind as ThemeKind,
            status: t.status as ThemeStatus,
            title: t.title,
            entry_text: e.text,
            entry_kind: e.kind as ThemeEntryKind,
            entry_status: e.status as ThemeEntryStatus,
            id: t.id,
            entry_id: e.id,
            last_touched_at: t.lastTouchedAt.toISOString(),
          });
        }
      }
      if (rows.length >= limit) break;
    }
    return rows.slice(0, limit);
  }

  private async indexTheme(id: string): Promise<void> {
    if (!this.embedder) return;
    const theme = await this.getById(id, 5);
    if (!theme) return;
    const embedding = await this.embedder.embed(
      `${theme.title}\n${theme.summary ?? ""}\n${theme.entries
        .map((e) => e.text)
        .join("\n")}`.trim(),
    );
    await this.db.$executeRawUnsafe(
      `UPDATE "themes" SET "embedding" = $1::vector WHERE "id" = $2::uuid`,
      toVectorLiteral(embedding),
      id,
    );
  }

  private async indexEntry(id: string): Promise<void> {
    if (!this.embedder) return;
    const entry = await this.db.themeEntry.findUnique({ where: { id } });
    if (!entry) return;
    const embedding = await this.embedder.embed(
      `${entry.text}\n${entry.rawUtterance ?? ""}`.trim(),
    );
    await this.db.$executeRawUnsafe(
      `UPDATE "theme_entries" SET "embedding" = $1::vector WHERE "id" = $2::uuid`,
      toVectorLiteral(embedding),
      id,
    );
  }
}
