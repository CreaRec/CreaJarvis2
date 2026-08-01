-- CreateEnum
CREATE TYPE "ThemeKind" AS ENUM ('idea', 'project', 'trip');

-- CreateEnum
CREATE TYPE "ThemeStatus" AS ENUM ('active', 'on_hold', 'done', 'archived');

-- CreateEnum
CREATE TYPE "ThemeEntryKind" AS ENUM ('note', 'question', 'decision', 'checklist', 'link');

-- CreateEnum
CREATE TYPE "ThemeEntryStatus" AS ENUM ('open', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "themes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "ThemeKind" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ThemeStatus" NOT NULL DEFAULT 'active',
    "summary" TEXT,
    "meta" JSONB,
    "rawUtterance" TEXT,
    "embedding" vector(1536),
    "lastTouchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theme_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "themeId" UUID NOT NULL,
    "kind" "ThemeEntryKind" NOT NULL DEFAULT 'note',
    "status" "ThemeEntryStatus" NOT NULL DEFAULT 'open',
    "text" TEXT NOT NULL,
    "rawUtterance" TEXT,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theme_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "themes_kind_status_idx" ON "themes"("kind", "status");

-- CreateIndex
CREATE INDEX "themes_lastTouchedAt_idx" ON "themes"("lastTouchedAt");

-- CreateIndex
CREATE INDEX "themes_embedding_hnsw_idx" ON "themes" USING hnsw ("embedding" vector_cosine_ops);

-- CreateIndex
CREATE INDEX "theme_entries_themeId_createdAt_idx" ON "theme_entries"("themeId", "createdAt");

-- CreateIndex
CREATE INDEX "theme_entries_embedding_hnsw_idx" ON "theme_entries" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "theme_entries" ADD CONSTRAINT "theme_entries_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
