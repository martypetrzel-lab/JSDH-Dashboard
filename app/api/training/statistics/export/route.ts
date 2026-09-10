import { getPrisma } from '@/lib/prisma';
import { trainingRequest } from '@/lib/training-server';
import { createTrainingStatisticsPdf } from '@/lib/training-statistics-pdf';
import { loadTrainingStatistics } from '@/lib/training-statistics-server';

export const runtime = 'nodejs';

export const GET = (request: Request) =>
  trainingRequest(async (actor) => {
    const statistics = await loadTrainingStatistics(request);
    if (!statistics.summary.sessions)
      return Response.json(
        { error: 'Ve zvoleném období nejsou žádná dokončená školení.' },
        { status: 422 },
      );
    const details = new URL(request.url).searchParams.get('details') === 'true';
    const bytes = await createTrainingStatisticsPdf(statistics, details);
    await getPrisma().auditLog.create({
      data: {
        actor,
        action: 'TRAINING_STATISTICS_PDF_GENERATED',
        entity: 'TrainingStatistics',
        entityId: `${statistics.period.from}:${statistics.period.to}`,
        description: `Vygenerován přehled odborné přípravy za období ${statistics.period.from} až ${statistics.period.to}.`,
      },
    });
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition':
          'attachment; filename="prehled-odborne-pripravy.pdf"',
        'cache-control': 'private, no-store',
      },
    });
  });
