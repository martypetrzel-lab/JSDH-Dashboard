import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { unavailabilityInputSchema } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';
import { refreshHardUnavailabilityForMembers } from '@/lib/service-availability-server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  try {
    const input = unavailabilityInputSchema.parse(await request.json());
    const record = await getPrisma().$transaction(async (tx) => {
      const created = await tx.unavailability.create({ data: { memberId: input.memberId, from: new Date(input.from), to: new Date(input.to), reason: input.reason || null }, include: { member: true } });
      await tx.auditLog.create({ data: { action: 'CREATE', entity: 'Unavailability', entityId: created.id, description: 'Nedostupnost včetně času byla vytvořena.', actor: 'Administrátor' } });
      return created;
    });
    const affectedServices = await refreshHardUnavailabilityForMembers([record.memberId]);
    return NextResponse.json({ record: { id: record.id, memberId: record.memberId, member: `${record.member.firstName} ${record.member.lastName}`, from: record.from.toISOString(), to: record.to.toISOString(), reason: record.reason ?? '', label: 'Nedostupnost' }, affectedServices }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Nedostupnost se nepodařilo uložit.' }, { status: 400 });
  }
}
