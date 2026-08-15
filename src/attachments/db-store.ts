import type { PrismaClient } from "@prisma/client";
import type { Embedder } from "../memory/embedder.js";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface AttachmentRow {
  id: string;
  userId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export class AttachmentDbStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly embedder: Embedder,
  ) {}

  async upsertFromPromote(input: {
    id: string;
    userId: string;
    storagePath: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    description: string;
  }): Promise<AttachmentRow> {
    const existing = await this.db.attachment.findUnique({
      where: {
        userId_sha256: { userId: input.userId, sha256: input.sha256 },
      },
    });
    if (existing) {
      return existing;
    }
    const created = await this.db.attachment.create({
      data: {
        id: input.id,
        userId: input.userId,
        storagePath: input.storagePath,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        description: input.description,
      },
    });
    if (input.description.trim()) {
      await this.updateEmbedding(created.id, input.description, input.filename);
    }
    return created;
  }

  async updateEmbedding(
    id: string,
    description: string,
    filename: string,
  ): Promise<void> {
    const embedding = await this.embedder.embed(
      `${filename}\n${description}`.slice(0, 8000),
    );
    const literal = toVectorLiteral(embedding);
    await this.db.$executeRawUnsafe(
      `UPDATE "attachments" SET "embedding" = $1::vector WHERE "id" = $2::uuid`,
      literal,
      id,
    );
  }

  async getById(id: string): Promise<AttachmentRow | null> {
    return this.db.attachment.findUnique({ where: { id } });
  }

  async search(input: {
    userId: string;
    query: string;
    limit?: number;
  }): Promise<Array<AttachmentRow & { score: number }>> {
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
    const queryEmbedding = await this.embedder.embed(input.query);
    const literal = toVectorLiteral(queryEmbedding);
    const rows = await this.db.$queryRawUnsafe<
      Array<AttachmentRow & { score: number }>
    >(
      `SELECT "id", "userId", "storagePath", "filename", "mimeType", "sizeBytes",
              "sha256", "description", "createdAt", "updatedAt",
              1 - ("embedding" <=> $1::vector) AS score
       FROM "attachments"
       WHERE "userId" = $2
         AND "embedding" IS NOT NULL
       ORDER BY "embedding" <=> $1::vector
       LIMIT $3`,
      literal,
      input.userId,
      limit,
    );
    return rows;
  }
}
