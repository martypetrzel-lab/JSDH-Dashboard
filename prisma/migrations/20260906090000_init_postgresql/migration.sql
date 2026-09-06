-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PrimaryRole" AS ENUM ('UNIT_COMMANDER', 'SQUAD_COMMANDER', 'DRIVER', 'FIREFIGHTER', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('COMMANDER', 'DRIVER', 'FIREFIGHTER');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SelectionMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" DATE,
    "primaryRole" "PrimaryRole" NOT NULL DEFAULT 'UNASSIGNED',
    "medicalExamAt" DATE,
    "medicalValidUntil" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reserveOnly" BOOLEAN NOT NULL DEFAULT false,
    "systemAccount" BOOLEAN NOT NULL DEFAULT false,
    "dt" BOOLEAN NOT NULL DEFAULT false,
    "canCommand" BOOLEAN NOT NULL DEFAULT false,
    "canDrive" BOOLEAN NOT NULL DEFAULT false,
    "canFight" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unavailability" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unavailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyService" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyServiceAssignment" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 1,
    "selectionMode" "SelectionMode" NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "roleSnapshot" TEXT NOT NULL,
    "dtSnapshot" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyServiceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "actor" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "weekStartDay" INTEGER NOT NULL DEFAULT 1,
    "weekStartHour" INTEGER NOT NULL DEFAULT 6,
    "weekEndDay" INTEGER NOT NULL DEFAULT 0,
    "weekEndHour" INTEGER NOT NULL DEFAULT 6,
    "fairDraw" BOOLEAN NOT NULL DEFAULT true,
    "considerTotal" BOOLEAN NOT NULL DEFAULT true,
    "considerRole" BOOLEAN NOT NULL DEFAULT true,
    "preferRested" BOOLEAN NOT NULL DEFAULT true,
    "allowConsecutive" BOOLEAN NOT NULL DEFAULT true,
    "minimumDt" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Prague',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MedicalTemplate" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Member_active_idx" ON "Member"("active");

-- CreateIndex
CREATE INDEX "Member_lastName_firstName_idx" ON "Member"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Unavailability_memberId_from_to_idx" ON "Unavailability"("memberId", "from", "to");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyService_weekStart_key" ON "WeeklyService"("weekStart");

-- CreateIndex
CREATE INDEX "WeeklyService_status_weekStart_idx" ON "WeeklyService"("status", "weekStart");

-- CreateIndex
CREATE INDEX "WeeklyServiceAssignment_memberId_idx" ON "WeeklyServiceAssignment"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyServiceAssignment_serviceId_role_slot_key" ON "WeeklyServiceAssignment"("serviceId", "role", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyServiceAssignment_serviceId_memberId_key" ON "WeeklyServiceAssignment"("serviceId", "memberId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "Unavailability" ADD CONSTRAINT "Unavailability_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyServiceAssignment" ADD CONSTRAINT "WeeklyServiceAssignment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "WeeklyService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyServiceAssignment" ADD CONSTRAINT "WeeklyServiceAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
