-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('pending', 'delivering', 'delivered', 'missed', 'cancelled', 'snoozed');

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "text" TEXT NOT NULL,
    "fireAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'pending',
    "rawUtterance" TEXT,
    "recurrence" JSONB,
    "quietHoursOverride" BOOLEAN,
    "deliveredAt" TIMESTAMP(3),
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminders_status_fireAt_idx" ON "reminders"("status", "fireAt");

-- CreateIndex
CREATE INDEX "reminders_fireAt_idx" ON "reminders"("fireAt");

-- CreateIndex
CREATE INDEX "reminders_embedding_hnsw_idx" ON "reminders" USING hnsw ("embedding" vector_cosine_ops);
