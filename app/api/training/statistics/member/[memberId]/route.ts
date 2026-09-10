import { trainingRequest } from '@/lib/training-server';
import { loadTrainingStatistics } from '@/lib/training-statistics-server';

export const runtime = 'nodejs';

export const GET = (
  request: Request,
  context: { params: Promise<{ memberId: string }> },
) =>
  trainingRequest(async () => {
    const statistics = await loadTrainingStatistics(
      request,
      (await context.params).memberId,
    );
    return Response.json({
      period: statistics.period,
      summary: statistics.members[0],
      sessions: statistics.members[0].sessions,
    });
  });
