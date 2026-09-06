ALTER TABLE "WeeklyService"
ADD COLUMN "needsCrewChange" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "crewIssue" TEXT;

UPDATE "WeeklyService" AS service
SET
  "needsCrewChange" = true,
  "crewIssue" = 'Člen základní sestavy je v tomto týdnu nedostupný.'
WHERE service.status IN ('DRAFT', 'CONFIRMED')
  AND EXISTS (
    SELECT 1
    FROM "WeeklyServiceAssignment" AS assignment
    INNER JOIN "Unavailability" AS unavailable
      ON unavailable."memberId" = assignment."memberId"
    WHERE assignment."serviceId" = service.id
      AND unavailable."from" < service."weekEnd"
      AND unavailable."to" > service."weekStart"
  );
