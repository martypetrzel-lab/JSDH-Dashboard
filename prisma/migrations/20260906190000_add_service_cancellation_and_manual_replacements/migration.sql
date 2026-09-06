-- Preserve cancelled services and distinguish emergency replacements from generated recurring replacements.
ALTER TABLE "WeeklyService"
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancellationReason" TEXT;

CREATE TYPE "ReplacementSource" AS ENUM ('RECURRING', 'MANUAL');

ALTER TABLE "ServiceReplacement"
ADD COLUMN "reason" TEXT,
ADD COLUMN "source" "ReplacementSource" NOT NULL DEFAULT 'RECURRING';
