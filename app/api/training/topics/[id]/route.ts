import { trainingRequest, topicSave, topicDelete } from '@/lib/training-server';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export const PATCH = (request: Request, ctx: Context) =>
  trainingRequest(async (actor) =>
    topicSave(request, actor, (await ctx.params).id),
  );
export const DELETE = (_request: Request, ctx: Context) =>
  trainingRequest(async (actor) => topicDelete((await ctx.params).id, actor));
