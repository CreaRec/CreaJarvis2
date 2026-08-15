-- CreateEnum
CREATE TYPE "ReminderAppleSyncStatus" AS ENUM ('pending', 'synced', 'failed');

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uid" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "notes" TEXT,
    "alarmMinutesBefore" JSONB,
    "locationName" TEXT,
    "locationAddress" TEXT,
    "locationMapsUrl" TEXT,
    "locationLat" DOUBLE PRECISION,
    "locationLon" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_end_after_start" CHECK ("endAt" > "startAt"),
    CONSTRAINT "events_lat_lon_pair" CHECK (
      ("locationLat" IS NULL AND "locationLon" IS NULL)
      OR ("locationLat" IS NOT NULL AND "locationLon" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "events_uid_key" ON "events"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "events_href_key" ON "events"("href");

-- CreateIndex
CREATE INDEX "events_startAt_endAt_idx" ON "events"("startAt", "endAt");

-- Backfill standalone events from calendar-linked reminders (no reminder FK).
INSERT INTO "events" (
  "id",
  "uid",
  "href",
  "title",
  "startAt",
  "endAt",
  "timezone",
  "notes",
  "alarmMinutesBefore",
  "locationName",
  "locationAddress",
  "locationMapsUrl",
  "locationLat",
  "locationLon",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  r."calendarUid",
  r."calendarHref",
  r."text",
  r."fireAt",
  CASE
    WHEN r."calendarEndAt" IS NOT NULL AND r."calendarEndAt" > r."fireAt"
      THEN r."calendarEndAt"
    ELSE r."fireAt" + INTERVAL '30 minutes'
  END,
  r."timezone",
  NULL,
  NULL,
  r."locationName",
  r."locationAddress",
  r."locationMapsUrl",
  CASE
    WHEN r."locationLat" IS NOT NULL AND r."locationLon" IS NOT NULL
      THEN r."locationLat"
    ELSE NULL
  END,
  CASE
    WHEN r."locationLat" IS NOT NULL AND r."locationLon" IS NOT NULL
      THEN r."locationLon"
    ELSE NULL
  END,
  r."createdAt",
  NOW()
FROM "reminders" r
WHERE r."calendarUid" IS NOT NULL
  AND r."calendarUid" <> ''
  AND r."calendarHref" IS NOT NULL
  AND r."calendarHref" <> ''
ON CONFLICT ("uid") DO NOTHING;

-- AlterTable reminders: add apple sync status
ALTER TABLE "reminders" ADD COLUMN "appleSyncStatus" "ReminderAppleSyncStatus" NOT NULL DEFAULT 'pending';

-- Drop legacy calendar / location / delivery columns and indexes
DROP INDEX IF EXISTS "reminders_calendarUid_key";
DROP INDEX IF EXISTS "reminders_status_fireAt_idx";

ALTER TABLE "reminders" DROP COLUMN IF EXISTS "status";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "quietHoursOverride";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "deliveredAt";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "calendarUid";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "calendarHref";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "calendarEndAt";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "locationName";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "locationAddress";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "locationMapsUrl";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "locationLat";
ALTER TABLE "reminders" DROP COLUMN IF EXISTS "locationLon";

CREATE INDEX "reminders_appleSyncStatus_fireAt_idx" ON "reminders"("appleSyncStatus", "fireAt");

-- DropEnum
DROP TYPE "ReminderStatus";
