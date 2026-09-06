CREATE TYPE "TemporaryAssignmentSource" AS ENUM ('RECURRING', 'MANUAL');

CREATE TABLE "ServiceTemporaryAssignment" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "from" TIMESTAMP(3) NOT NULL,
  "to" TIMESTAMP(3) NOT NULL,
  "role" "AssignmentRole" NOT NULL,
  "slot" INTEGER NOT NULL DEFAULT 1,
  "memberId" TEXT NOT NULL,
  "originalAssignmentId" TEXT,
  "source" "TemporaryAssignmentSource" NOT NULL DEFAULT 'RECURRING',
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceTemporaryAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceTemporaryAssignment_serviceId_from_to_role_slot_key" ON "ServiceTemporaryAssignment"("serviceId", "from", "to", "role", "slot");
CREATE INDEX "ServiceTemporaryAssignment_serviceId_from_to_idx" ON "ServiceTemporaryAssignment"("serviceId", "from", "to");
CREATE INDEX "ServiceTemporaryAssignment_memberId_from_to_idx" ON "ServiceTemporaryAssignment"("memberId", "from", "to");
ALTER TABLE "ServiceTemporaryAssignment" ADD CONSTRAINT "ServiceTemporaryAssignment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "WeeklyService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceTemporaryAssignment" ADD CONSTRAINT "ServiceTemporaryAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceTemporaryAssignment" ADD CONSTRAINT "ServiceTemporaryAssignment_originalAssignmentId_fkey" FOREIGN KEY ("originalAssignmentId") REFERENCES "WeeklyServiceAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
