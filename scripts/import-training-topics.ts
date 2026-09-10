import { getPrisma } from '../lib/prisma';
import {
  importTrainingTopics,
  legacyTrainingTopicCodes,
  trainingTopicCatalog,
} from '../prisma/training-topics';
const prisma = getPrisma();
try {
  await prisma.$transaction(
    async (tx) => {
      await importTrainingTopics((topic) =>
        tx.trainingTopic.upsert({
          where: { code: topic.code },
          update: {
            name: topic.name,
            category: topic.category,
            subcategory: topic.subcategory,
            description: topic.description,
            source: topic.source,
            sourceUrl: topic.sourceUrl,
            sourceType: topic.sourceType,
            sortOrder: topic.sortOrder,
          },
          create: { ...topic, active: true },
        }),
      );
      await tx.trainingTopic.updateMany({
        where: {
          code: {
            in: [...legacyTrainingTopicCodes],
            notIn: trainingTopicCatalog.map((topic) => topic.code),
          },
        },
        data: { active: false },
      });
    },
    { timeout: 60000 },
  );
  console.log(
    `Importováno / aktualizováno ${trainingTopicCatalog.length} témat odborné přípravy.`,
  );
} finally {
  await prisma.$disconnect();
}
