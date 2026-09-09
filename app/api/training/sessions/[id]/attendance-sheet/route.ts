import { getPrisma } from '@/lib/prisma';
import { trainingRequest, trainingInclude } from '@/lib/training-server';
import { createAttendancePdf } from '@/lib/training-pdf';
import type { TrainingSessionRow } from '@/lib/training';
export const runtime = 'nodejs';
export const GET = (
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) =>
  trainingRequest(async (actor) => {
    const { id } = await ctx.params;
    const prisma = getPrisma();
    const session = await prisma.trainingSession.findUniqueOrThrow({
      where: { id },
      include: trainingInclude,
    });
    const bytes = await createAttendancePdf(
      JSON.parse(JSON.stringify(session)) as TrainingSessionRow,
    );
    await prisma.auditLog.create({
      data: {
        actor,
        action: 'TRAINING_ATTENDANCE_SHEET_GENERATED',
        entity: 'TrainingSession',
        entityId: id,
        description:
          'Vygenerována prezenční listina pro ' +
          session.date.toISOString().slice(0, 10) +
          '.',
      },
    });
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          'attachment; filename="prezencni-listina-' +
          session.date.toISOString().slice(0, 10) +
          '.pdf"',
        'Cache-Control': 'private, no-store',
      },
    });
  });
