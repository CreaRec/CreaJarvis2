-- AlterTable: add recurring / all-day / sync fields
ALTER TABLE "events" ADD COLUMN "recurrenceId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "events" ADD COLUMN "recurrenceRule" TEXT;
ALTER TABLE "events" ADD COLUMN "isAllDay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "events" ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);
ALTER TABLE "events" ADD COLUMN "lastSeenSyncId" UUID;

-- Drop old unique constraints on uid and href
DROP INDEX IF EXISTS "events_uid_key";
DROP INDEX IF EXISTS "events_href_key";

-- Composite identity: master/non-recurring use recurrenceId = ''
CREATE UNIQUE INDEX "events_uid_recurrenceId_key" ON "events"("uid", "recurrenceId");

-- href is no longer unique (one .ics may hold master + exceptions)
CREATE INDEX "events_href_idx" ON "events"("href");
CREATE INDEX "events_lastSeenSyncId_idx" ON "events"("lastSeenSyncId");
