CREATE TYPE "TrainingTopicSource" AS ENUM ('HASICI_VZDELAVANI', 'INTERNAL', 'OTHER');
CREATE TYPE "TrainingType" AS ENUM ('THEORY', 'PRACTICE', 'COMBINED');
CREATE TYPE "TrainingStatus" AS ENUM ('DRAFT', 'COMPLETED');
CREATE TYPE "TrainingAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');
CREATE TABLE "TrainingTopic" (
 "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "category" TEXT NOT NULL,
 "description" TEXT, "source" TEXT, "sourceUrl" TEXT, "sourceType" "TrainingTopicSource" NOT NULL DEFAULT 'INTERNAL',
 "active" BOOLEAN NOT NULL DEFAULT true, "sortOrder" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "TrainingTopic_code_key" ON "TrainingTopic"("code");
CREATE INDEX "TrainingTopic_active_category_idx" ON "TrainingTopic"("active", "category");
CREATE TABLE "TrainingSession" (
 "id" TEXT PRIMARY KEY, "date" DATE NOT NULL, "startTime" TIMESTAMP(3), "endTime" TIMESTAMP(3),
 "durationMinutes" INTEGER NOT NULL CHECK ("durationMinutes" > 0), "location" TEXT,
 "trainingType" "TrainingType" NOT NULL, "instructorName" TEXT NOT NULL, "instructorMemberId" TEXT,
 "notes" TEXT, "status" "TrainingStatus" NOT NULL DEFAULT 'DRAFT',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "TrainingSession_instructorMemberId_fkey" FOREIGN KEY ("instructorMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TrainingSession_date_idx" ON "TrainingSession"("date");
CREATE TABLE "TrainingSessionTopic" (
 "id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL, "topicId" TEXT NOT NULL, "nameSnapshot" TEXT NOT NULL, "categorySnapshot" TEXT NOT NULL,
 CONSTRAINT "TrainingSessionTopic_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "TrainingSessionTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TrainingTopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingSessionTopic_sessionId_topicId_key" ON "TrainingSessionTopic"("sessionId", "topicId");
CREATE TABLE "TrainingParticipant" (
 "id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "status" "TrainingAttendanceStatus" NOT NULL,
 "note" TEXT, "signedAt" TIMESTAMP(3), "nameSnapshot" TEXT NOT NULL, "roleSnapshot" TEXT NOT NULL,
 CONSTRAINT "TrainingParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "TrainingParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TrainingParticipant_sessionId_memberId_key" ON "TrainingParticipant"("sessionId", "memberId");
CREATE INDEX "TrainingParticipant_memberId_idx" ON "TrainingParticipant"("memberId");
