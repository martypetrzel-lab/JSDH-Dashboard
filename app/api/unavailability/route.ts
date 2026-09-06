import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { unavailabilityInputSchema } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  try {
    const input = unavailabilityInputSchema.parse(await request.json());
    const record = await getPrisma().unavailability.create({ data: { memberId: input.memberId, from: new Date(input.from), to: new Date(input.to), reason: input.reason || null }, include: { member: true } });
    await getPrisma().auditLog.create({ data: { action: 'CREATE', entity: 'Unavailability', entityId: record.id, description: 'Nedostupnost byla vytvořena.', actor: 'Administrátor' } });
    return NextResponse.json({ record: { id: record.id, memberId: record.memberId, member: `${record.member.firstName} ${record.member.lastName}`, from: record.from.toISOString(), to: record.to.toISOString(), reason: record.reason ?? '', label: 'Nový záznam' } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Nedostupnost se nepodařilo uložit.' }, { status: 400 });
  }
}
