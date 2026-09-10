import { getPrisma } from '@/lib/prisma';
import { trainingRequest } from '@/lib/training-server';
import { createMemberTrainingStatisticsPdf } from '@/lib/training-statistics-pdf';
import { loadTrainingStatistics } from '@/lib/training-statistics-server';

export const runtime = 'nodejs';

export const GET = (
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) =>
  trainingRequest(async (actor) => {
    const memberId = (await context.params).memberId;
    const statistics = await loadTrainingStatistics(request, memberId);
    const member = statistics.members[0];
    if (!member.recordedSessions)
      return Response.json(
        { error: 'Člen nemá ve zvoleném období evidovanou odbornou přípravu.' },
        { status: 422 },
      );
    const bytes = await createMemberTrainingStatisticsPdf(statistics, member);
    await getPrisma().auditLog.create({
      data: {
        actor,
        action: 'TRAINING_MEMBER_STATISTICS_PDF_GENERATED',
        entity: 'Member',
        entityId: memberId,
        description: `Vygenerován přehled odborné přípravy člena za období ${statistics.period.from} až ${statistics.period.to}.`,
      },
    });
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition':
          'attachment; filename="prehled-odborne-pripravy-clena.pdf"',
        'cache-control': 'private, no-store',
      },
    });
  });
