import { NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/auth';
import { memberInputSchema, parseCzechDate, primaryRole, serializeMember, splitName } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  try {
    const { id } = await context.params;
    const input = memberInputSchema.parse(await request.json());
    const member = await getPrisma().member.update({ where: { id }, data: {
      ...splitName(input.name), primaryRole: primaryRole(input.role), medicalValidUntil: parseCzechDate(input.medicalValidUntil),
      canCommand: input.permissions.includes('Velitel'), canDrive: input.permissions.includes('Strojník'), canFight: input.permissions.includes('Hasič'), dt: input.dt,
    } });
    await getPrisma().auditLog.create({ data: { action: 'UPDATE', entity: 'Member', entityId: id, description: 'Údaje člena byly upraveny.', actor: 'Administrátor' } });
    return NextResponse.json({ member: serializeMember(member) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Změny se nepodařilo uložit.' }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  const { id } = await context.params;
  await getPrisma().$transaction([
    getPrisma().member.update({ where: { id }, data: { active: false } }),
    getPrisma().auditLog.create({ data: { action: 'DEACTIVATE', entity: 'Member', entityId: id, description: 'Člen byl deaktivován.', actor: 'Administrátor' } }),
  ]);
  return NextResponse.json({ ok: true });
}
