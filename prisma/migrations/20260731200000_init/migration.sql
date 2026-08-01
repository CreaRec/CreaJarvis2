-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "MemoryBranch" AS ENUM ('user', 'directives', 'world');

-- CreateEnum
CREATE TYPE "MemoryConfidence" AS ENUM ('high', 'medium', 'assumption');

-- CreateEnum
CREATE TYPE "MemorySensitivity" AS ENUM ('normal', 'private');

-- CreateTable
CREATE TABLE "facts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch" "MemoryBranch" NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "confidence" "MemoryConfidence" NOT NULL DEFAULT 'medium',
    "sensitivity" "MemorySensitivity" NOT NULL DEFAULT 'normal',
    "source" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "meta_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "facts_contentHash_key" ON "facts"("contentHash");

-- CreateIndex
CREATE INDEX "facts_branch_active_idx" ON "facts"("branch", "active");

-- CreateIndex
CREATE INDEX "facts_topic_idx" ON "facts"("topic");

-- CreateIndex
CREATE INDEX "facts_embedding_hnsw_idx" ON "facts" USING hnsw ("embedding" vector_cosine_ops);
