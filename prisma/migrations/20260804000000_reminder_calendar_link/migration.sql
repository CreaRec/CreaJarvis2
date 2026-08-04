-- AlterTable
ALTER TABLE "reminders" ADD COLUMN "calendarUid" TEXT;
ALTER TABLE "reminders" ADD COLUMN "calendarHref" TEXT;
ALTER TABLE "reminders" ADD COLUMN "calendarEndAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "reminders_calendarUid_key" ON "reminders"("calendarUid");
