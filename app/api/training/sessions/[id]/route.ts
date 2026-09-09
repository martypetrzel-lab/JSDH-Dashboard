import {
  trainingRequest,
  sessionGet,
  sessionSave,
  sessionDelete,
} from '@/lib/training-server';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export const GET = (_request: Request, ctx: Context) =>
  trainingRequest(async () => sessionGet((await ctx.params).id));
export const PATCH = (request: Request, ctx: Context) =>
  trainingRequest(async (actor) =>
    sessionSave(request, actor, (await ctx.params).id),
  );
export const DELETE = (request: Request, ctx: Context) =>
  trainingRequest(async (actor) =>
    sessionDelete(request, (await ctx.params).id, actor),
  );
