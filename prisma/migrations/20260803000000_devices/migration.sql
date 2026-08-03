-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('desktop', 'pi', 'esp', 'other');

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "room" TEXT,
    "purpose" TEXT,
    "kind" "DeviceKind" NOT NULL DEFAULT 'desktop',
    "capsVoice" BOOLEAN NOT NULL DEFAULT true,
    "capsNotify" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "devices_archived_lastSeenAt_idx" ON "devices"("archived", "lastSeenAt");
