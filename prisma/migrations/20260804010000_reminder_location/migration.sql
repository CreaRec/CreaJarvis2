-- AlterTable
ALTER TABLE "reminders" ADD COLUMN "locationName" TEXT;
ALTER TABLE "reminders" ADD COLUMN "locationAddress" TEXT;
ALTER TABLE "reminders" ADD COLUMN "locationMapsUrl" TEXT;
ALTER TABLE "reminders" ADD COLUMN "locationLat" DOUBLE PRECISION;
ALTER TABLE "reminders" ADD COLUMN "locationLon" DOUBLE PRECISION;
