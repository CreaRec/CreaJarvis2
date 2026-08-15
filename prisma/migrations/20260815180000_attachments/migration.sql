-- AlterTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attachments_userId_sha256_key" ON "attachments"("userId", "sha256");
CREATE INDEX "attachments_userId_createdAt_idx" ON "attachments"("userId", "createdAt");
