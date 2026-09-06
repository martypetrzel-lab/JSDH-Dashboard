import { requireAdmin } from '@/lib/auth';
import { serializeMember, type AbsenceRow } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';
import { ServiceApp } from './service-app';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await requireAdmin();
  const prisma = getPrisma();
  const [members, unavailability, template] = await Promise.all([
    prisma.member.findMany({ where: { active: true, systemAccount: false }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.unavailability.findMany({ include: { member: true }, orderBy: { from: 'asc' } }),
    prisma.medicalTemplate.findUnique({ where: { id: 'current' }, select: { filename: true } }),
  ]);
  const absences: AbsenceRow[] = unavailability.map((item) => ({
    id: item.id,
    memberId: item.memberId,
    member: `${item.member.firstName} ${item.member.lastName}`,
    from: item.from.toISOString(),
    to: item.to.toISOString(),
    reason: item.reason ?? '',
    label: 'Evidováno',
  }));
  return <ServiceApp adminName={session.username} initialMembers={members.map(serializeMember)} initialAbsences={absences} initialTemplateName={template?.filename ?? null} />;
}
