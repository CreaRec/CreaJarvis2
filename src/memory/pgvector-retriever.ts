import type { PrismaClient } from "@prisma/client";
import type { Embedder } from "./embedder.js";
import type { MemoryStore } from "./store.js";
import type { MemoryRetriever, RankedHit, SearchParams } from "./types.js";

export class PgVectorRetriever implements MemoryRetriever {
  constructor(
    private readonly db: PrismaClient,
    private readonly store: MemoryStore,
    private readonly embedder: Embedder,
  ) {}

  async search(params: SearchParams): Promise<RankedHit[]> {
    const limit = params.limit ?? 8;
    try {
      const queryEmbedding = await this.embedder.embed(params.query);
      const literal = `[${queryEmbedding.join(",")}]`;

      const rows = params.branch
        ? await this.db.$queryRawUnsafe<Array<{ id: string; score: number }>>(
            `SELECT "id"::text AS id, 1 - ("embedding" <=> $1::vector) AS score
             FROM "facts"
             WHERE active = TRUE
               AND "embedding" IS NOT NULL
               AND branch = $2::"MemoryBranch"
             ORDER BY "embedding" <=> $1::vector
             LIMIT $3`,
            literal,
            params.branch,
            limit,
          )
        : await this.db.$queryRawUnsafe<Array<{ id: string; score: number }>>(
            `SELECT "id"::text AS id, 1 - ("embedding" <=> $1::vector) AS score
             FROM "facts"
             WHERE active = TRUE
               AND "embedding" IS NOT NULL
             ORDER BY "embedding" <=> $1::vector
             LIMIT $2`,
            literal,
            limit,
          );

      if (rows.length > 0) {
        return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
      }
    } catch (err) {
      console.warn("[retriever] vector search failed, falling back to keyword:", err);
    }

    const facts = await this.store.keywordFallback(
      params.query,
      params.branch,
      limit,
    );
    return facts.map((f, i) => ({ id: f.id, score: 1 - i * 0.05 }));
  }

  async index(id: string): Promise<void> {
    const fact = await this.store.getById(id);
    if (!fact) return;
    const embedding = await this.embedder.embed(
      `${fact.topic}\n${fact.text}`.trim(),
    );
    await this.store.updateEmbedding(id, embedding);
  }
}

export function createRetriever(
  kind: "pgvector" | "qdrant",
  deps: { db: PrismaClient; store: MemoryStore; embedder: Embedder },
): MemoryRetriever {
  if (kind === "qdrant") {
    throw new Error(
      "MEMORY_RETRIEVER=qdrant is not implemented yet. Add a qdrant service and QdrantRetriever.",
    );
  }
  return new PgVectorRetriever(deps.db, deps.store, deps.embedder);
}
