import { trainingRequest, attendanceSave } from '@/lib/training-server';
export const runtime = 'nodejs';
export const PATCH = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) =>
  trainingRequest(async (actor) =>
    attendanceSave(request, (await ctx.params).id, actor),
  );
