import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { unavailabilityInputSchema } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';
import { refreshHardUnavailabilityForMembers } from '@/lib/service-availability-server';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  try {
    const { id } = await context.params;
    const input = unavailabilityInputSchema.parse(await request.json());
    const previous = await getPrisma().unavailability.findUnique({ where: { id }, select: { memberId: true } });
    const record = await getPrisma().$transaction(async (tx) => {
      const updated = await tx.unavailability.update({ where: { id }, data: { memberId: input.memberId, from: new Date(input.from), to: new Date(input.to), reason: input.reason || null }, include: { member: true } });
      await tx.auditLog.create({ data: { action: 'UPDATE', entity: 'Unavailability', entityId: id, description: 'Datum, čas nebo důvod nedostupnosti byl upraven.', actor: 'Administrátor' } });
      return updated;
    });
    const affectedServices = await refreshHardUnavailabilityForMembers([previous?.memberId ?? '', record.memberId]);
    return NextResponse.json({ record: { id, memberId: record.memberId, member: `${record.member.firstName} ${record.member.lastName}`, from: record.from.toISOString(), to: record.to.toISOString(), reason: record.reason ?? '', label: 'Nedostupnost' }, affectedServices });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Nedostupnost se nepodařilo upravit.' }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  const { id } = await context.params;
  const previous = await getPrisma().unavailability.findUnique({ where: { id }, select: { memberId: true } });
  await getPrisma().$transaction([
    getPrisma().unavailability.delete({ where: { id } }),
    getPrisma().auditLog.create({ data: { action: 'DELETE', entity: 'Unavailability', entityId: id, description: 'Nedostupnost byla odstraněna.', actor: 'Administrátor' } }),
  ]);
  const affectedServices = await refreshHardUnavailabilityForMembers([previous?.memberId ?? '']);
  return NextResponse.json({ ok: true, affectedServices });
}
