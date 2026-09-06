CREATE TABLE "RecurringUnavailability" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "anchorStart" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "intervalMinutes" INTEGER NOT NULL,
  "reason" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringUnavailability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceReplacement" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "originalMemberId" TEXT NOT NULL,
  "replacementMemberId" TEXT,
  "role" "AssignmentRole" NOT NULL,
  "from" TIMESTAMP(3) NOT NULL,
  "to" TIMESTAMP(3) NOT NULL,
  "valid" BOOLEAN NOT NULL DEFAULT false,
  "issue" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceReplacement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecurringUnavailability_memberId_active_anchorStart_idx" ON "RecurringUnavailability"("memberId", "active", "anchorStart");
CREATE UNIQUE INDEX "ServiceReplacement_assignmentId_from_to_key" ON "ServiceReplacement"("assignmentId", "from", "to");
CREATE INDEX "ServiceReplacement_serviceId_from_to_idx" ON "ServiceReplacement"("serviceId", "from", "to");
CREATE INDEX "ServiceReplacement_replacementMemberId_from_to_idx" ON "ServiceReplacement"("replacementMemberId", "from", "to");
ALTER TABLE "RecurringUnavailability" ADD CONSTRAINT "RecurringUnavailability_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceReplacement" ADD CONSTRAINT "ServiceReplacement_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "WeeklyService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceReplacement" ADD CONSTRAINT "ServiceReplacement_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "WeeklyServiceAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceReplacement" ADD CONSTRAINT "ServiceReplacement_originalMemberId_fkey" FOREIGN KEY ("originalMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceReplacement" ADD CONSTRAINT "ServiceReplacement_replacementMemberId_fkey" FOREIGN KEY ("replacementMemberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
