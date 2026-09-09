import {
  trainingRequest,
  sessionsGet,
  sessionSave,
} from '@/lib/training-server';
export const runtime = 'nodejs';
export const GET = (request: Request) =>
  trainingRequest(() => sessionsGet(request));
export const POST = (request: Request) =>
  trainingRequest((actor) => sessionSave(request, actor));
