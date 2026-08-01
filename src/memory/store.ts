import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { MemoryBranch, MemoryFact, NewFact } from "./types.js";

function toFact(row: {
  id: string;
  branch: MemoryFact["branch"];
  topic: string;
  text: string;
  confidence: MemoryFact["confidence"];
  sensitivity: MemoryFact["sensitivity"];
  source: string;
  contentHash: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): MemoryFact {
  return {
    id: row.id,
    branch: row.branch,
    topic: row.topic,
    text: row.text,
    confidence: row.confidence,
    sensitivity: row.sensitivity,
    source: row.source,
    contentHash: row.contentHash,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function hashFactContent(source: string, text: string): string {
  return createHash("sha256").update(`${source}\n${text}`).digest("hex");
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2)
    .slice(0, 8);
}

function keywordOrFilters(query: string, tokens: string[]) {
  const q = query.trim();
  const filters: Array<
    | { topic: { contains: string; mode: "insensitive" } }
    | { text: { contains: string; mode: "insensitive" } }
  > = [];
  if (q.length > 0) {
    filters.push(
      { topic: { contains: q, mode: "insensitive" } },
      { text: { contains: q, mode: "insensitive" } },
    );
  }
  for (const t of tokens) {
    filters.push(
      { topic: { contains: t, mode: "insensitive" } },
      { text: { contains: t, mode: "insensitive" } },
    );
  }
  return filters;
}

/** Higher = better topical match; phrase hit outweighs single tokens. */
export function scoreFactMatch(
  query: string,
  tokens: string[],
  topic: string,
  text: string,
): number {
  const hay = `${topic} ${text}`.toLowerCase();
  const q = query.toLowerCase().trim();
  let score = 0;
  if (q.length > 0 && hay.includes(q)) score += 3;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

export class MemoryStore {
  constructor(private readonly db: PrismaClient) {}

  async save(fact: NewFact): Promise<MemoryFact> {
    const row = await this.db.fact.upsert({
      where: { contentHash: fact.contentHash },
      create: {
        branch: fact.branch,
        topic: fact.topic ?? "",
        text: fact.text,
        confidence: fact.confidence ?? "medium",
        sensitivity: fact.sensitivity ?? "normal",
        source: fact.source ?? "",
        contentHash: fact.contentHash,
        active: true,
      },
      update: {
        branch: fact.branch,
        topic: fact.topic ?? "",
        text: fact.text,
        confidence: fact.confidence ?? "medium",
        sensitivity: fact.sensitivity ?? "normal",
        source: fact.source ?? "",
        active: true,
      },
    });
    return toFact(row);
  }

  async getByIds(ids: string[]): Promise<MemoryFact[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.fact.findMany({
      where: { id: { in: ids }, active: true },
    });
    const byId = new Map(rows.map((r) => [r.id, toFact(r)]));
    return ids.map((id) => byId.get(id)).filter((f): f is MemoryFact => Boolean(f));
  }

  async getById(id: string): Promise<MemoryFact | null> {
    const rows = await this.getByIds([id]);
    return rows[0] ?? null;
  }

  async deactivate(id: string): Promise<void> {
    await this.db.fact.update({
      where: { id },
      data: { active: false },
    });
  }

  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    const literal = toVectorLiteral(embedding);
    await this.db.$executeRawUnsafe(
      `UPDATE "facts" SET "embedding" = $1::vector WHERE "id" = $2::uuid`,
      literal,
      id,
    );
  }

  async listForWarmProfile(opts: {
    branch: MemoryBranch;
    maxChars: number;
    includePrivate?: boolean;
  }): Promise<MemoryFact[]> {
    const rows = await this.db.fact.findMany({
      where: {
        active: true,
        branch: opts.branch,
        ...(opts.includePrivate ? {} : { sensitivity: "normal" }),
      },
      orderBy: [{ confidence: "asc" }, { updatedAt: "desc" }],
    });

    const confidenceRank: Record<string, number> = {
      high: 0,
      medium: 1,
      assumption: 2,
    };
    rows.sort(
      (a, b) =>
        (confidenceRank[a.confidence] ?? 9) - (confidenceRank[b.confidence] ?? 9),
    );

    const facts: MemoryFact[] = [];
    let used = 0;
    for (const row of rows) {
      const fact = toFact(row);
      const next = used + fact.text.length + 1;
      if (next > opts.maxChars && facts.length > 0) break;
      facts.push(fact);
      used = next;
    }
    return facts;
  }

  async keywordFallback(
    query: string,
    branch: MemoryBranch | undefined,
    limit: number,
  ): Promise<MemoryFact[]> {
    const tokens = tokenizeQuery(query);

    if (tokens.length === 0) {
      const rows = await this.db.fact.findMany({
        where: {
          active: true,
          ...(branch ? { branch } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      return rows.map(toFact);
    }

    const rows = await this.db.fact.findMany({
      where: {
        active: true,
        ...(branch ? { branch } : {}),
        OR: keywordOrFilters(query, tokens),
      },
      orderBy: { updatedAt: "desc" },
      take: limit * 3,
    });

    const scored = rows.map((row) => {
      const score = scoreFactMatch(query, tokens, row.topic, row.text);
      return { fact: toFact(row), score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.fact);
  }

  /**
   * Chronological arc of facts matching a topic/query (oldest→newest).
   * If more than `limit` matches, keeps the most recent window still ordered by time.
   */
  async timeline(params: {
    query: string;
    branch?: MemoryBranch;
    limit?: number;
  }): Promise<MemoryFact[]> {
    const limit = Math.min(Math.max(params.limit ?? 15, 1), 30);
    const tokens = tokenizeQuery(params.query);
    const filters = keywordOrFilters(params.query, tokens);
    if (filters.length === 0) return [];

    const fetchCap = Math.min(Math.max(limit * 8, 40), 120);

    const rows = await this.db.fact.findMany({
      where: {
        active: true,
        ...(params.branch ? { branch: params.branch } : {}),
        OR: filters,
      },
      orderBy: { createdAt: "asc" },
      take: fetchCap,
    });

    const scored = rows
      .map((row) => ({
        fact: toFact(row),
        score: scoreFactMatch(params.query, tokens, row.topic, row.text),
      }))
      .filter((s) => s.score > 0);

    scored.sort(
      (a, b) => a.fact.createdAt.getTime() - b.fact.createdAt.getTime(),
    );

    const facts = scored.map((s) => s.fact);
    return facts.length > limit ? facts.slice(-limit) : facts;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.meta.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
