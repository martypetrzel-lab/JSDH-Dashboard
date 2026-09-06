import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { memberInputSchema, parseCzechDate, primaryRole, serializeMember, splitName } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET() {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  const members = await getPrisma().member.findMany({ where: { active: true, systemAccount: false }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  return NextResponse.json({ members: members.map(serializeMember) });
}

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  try {
    const input = memberInputSchema.parse(await request.json());
    const names = splitName(input.name);
    const member = await getPrisma().member.create({ data: {
      ...names,
      primaryRole: primaryRole(input.role),
      medicalValidUntil: parseCzechDate(input.medicalValidUntil),
      canCommand: input.permissions.includes('Velitel'),
      canDrive: input.permissions.includes('Strojník'),
      canFight: input.permissions.includes('Hasič'),
      dt: input.dt,
    } });
    await getPrisma().auditLog.create({ data: { action: 'CREATE', entity: 'Member', entityId: member.id, description: 'Člen byl vytvořen.', actor: 'Administrátor' } });
    return NextResponse.json({ member: serializeMember(member) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Člena se nepodařilo vytvořit.' }, { status: 400 });
  }
}
