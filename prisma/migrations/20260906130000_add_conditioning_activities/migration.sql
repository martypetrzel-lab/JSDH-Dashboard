CREATE TYPE "DtActivityType" AS ENUM ('CONDITIONING', 'INCIDENT');
CREATE TYPE "DriverActivityType" AS ENUM ('CONDITIONING', 'INCIDENT');

ALTER TABLE "Settings" ADD COLUMN "conditioningWarningDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "DtActivity" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "type" "DtActivityType" NOT NULL,
  "cylinderNumber" TEXT,
  "carrierNumber" TEXT,
  "maskNumber" TEXT,
  "incidentReference" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DtActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverActivity" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "type" "DriverActivityType" NOT NULL,
  "vehicle" TEXT NOT NULL,
  "kilometers" INTEGER,
  "incidentReference" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriverActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DtActivity_memberId_date_idx" ON "DtActivity"("memberId", "date");
CREATE INDEX "DriverActivity_memberId_date_idx" ON "DriverActivity"("memberId", "date");
ALTER TABLE "DtActivity" ADD CONSTRAINT "DtActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverActivity" ADD CONSTRAINT "DriverActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
