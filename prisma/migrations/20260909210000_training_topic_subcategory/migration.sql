ALTER TABLE "TrainingTopic"
ADD COLUMN "subcategory" TEXT NOT NULL DEFAULT 'Nezařazeno';

ALTER TABLE "TrainingSessionTopic"
ADD COLUMN "subcategorySnapshot" TEXT NOT NULL DEFAULT 'Nezařazeno';
