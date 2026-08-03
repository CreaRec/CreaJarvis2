-- CreateEnum
CREATE TYPE "DeviceRoom" AS ENUM (
  'master_bedroom',
  'master_bathroom',
  'kitchen_living',
  'garage',
  'office',
  'poker_room',
  'play_room',
  'kids_room',
  'kids_office',
  'guest_room'
);

-- Clear free-text rooms that are not catalog ids (cannot cast safely)
UPDATE "devices"
SET "room" = NULL
WHERE "room" IS NOT NULL
  AND "room" NOT IN (
    'master_bedroom',
    'master_bathroom',
    'kitchen_living',
    'garage',
    'office',
    'poker_room',
    'play_room',
    'kids_room',
    'kids_office',
    'guest_room'
  );

-- AlterTable: text → enum
ALTER TABLE "devices"
  ALTER COLUMN "room" TYPE "DeviceRoom"
  USING (
    CASE
      WHEN "room" IS NULL THEN NULL
      ELSE "room"::"DeviceRoom"
    END
  );
