import { trainingRequest, topicsGet, topicSave } from '@/lib/training-server';
export const runtime = 'nodejs';
export const GET = () => trainingRequest(() => topicsGet());
export const POST = (request: Request) =>
  trainingRequest((actor) => topicSave(request, actor));
