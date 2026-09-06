ALTER TABLE "Settings" ALTER COLUMN "weekEndDay" SET DEFAULT 1;
UPDATE "Settings" SET "weekEndDay" = 1, "weekEndHour" = 6;
UPDATE "WeeklyService"
SET "weekEnd" = ((((("weekStart" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague') + INTERVAL '7 days') AT TIME ZONE 'Europe/Prague') AT TIME ZONE 'UTC');
