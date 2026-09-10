import { trainingRequest } from '@/lib/training-server';
import { loadTrainingStatistics } from '@/lib/training-statistics-server';

export const runtime = 'nodejs';

export const GET = (request: Request) =>
  trainingRequest(async () =>
    Response.json(await loadTrainingStatistics(request)),
  );
