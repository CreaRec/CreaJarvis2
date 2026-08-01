-- CreateEnum
CREATE TYPE "PlanItemStatus" AS ENUM ('open', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "day_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "localDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "status" "PlanItemStatus" NOT NULL DEFAULT 'open',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "reminderId" UUID,
    "recurrence" JSONB,
    "rawUtterance" TEXT,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "day_plans_localDate_key" ON "day_plans"("localDate");

-- CreateIndex
CREATE INDEX "plan_items_planId_status_sortOrder_idx" ON "plan_items"("planId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "plan_items_scheduledAt_idx" ON "plan_items"("scheduledAt");

-- CreateIndex
CREATE INDEX "plan_items_embedding_hnsw_idx" ON "plan_items" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "day_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
