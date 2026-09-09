import { getPrisma } from '../lib/prisma';
import { importTrainingTopics } from '../prisma/training-topics';
const prisma = getPrisma();
try {
  await prisma.$transaction(
    async (tx) => {
      await importTrainingTopics((topic) =>
        tx.trainingTopic.upsert({
          where: { code: topic.code },
          update: {},
          create: { ...topic },
        }),
      );
    },
    { timeout: 60000 },
  );
  console.log('Knihovna témat byla importována.');
} finally {
  await prisma.$disconnect();
}
