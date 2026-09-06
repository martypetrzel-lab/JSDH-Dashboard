import { requireAdmin } from '@/lib/auth';
import { serializeMember, type AbsenceRow } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';
import { serializeWeeklyService } from '@/lib/weekly-service-data';
import { ServiceApp } from './service-app';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await requireAdmin();
  const prisma = getPrisma();
  const now = new Date();
  const [members, unavailability, template, settings, currentService] = await Promise.all([
    prisma.member.findMany({ where: { active: true, systemAccount: false }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.unavailability.findMany({ include: { member: true }, orderBy: { from: 'asc' } }),
    prisma.medicalTemplate.findUnique({ where: { id: 'current' }, select: { filename: true } }),
    prisma.settings.findUnique({ where: { id: 'default' }, select: { weekStartDay: true, weekStartHour: true, weekEndDay: true, weekEndHour: true, minimumDt: true, timezone: true } }),
    prisma.weeklyService.findFirst({ where: { status: { in: ['DRAFT','CONFIRMED'] }, weekStart: { lte: new Date(now.getTime()+7*86400000) }, weekEnd: { gt: now } }, include: { assignments: { orderBy: [{ role: 'asc' }, { slot: 'asc' }] } }, orderBy: { weekStart: 'asc' } }),
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
  const service=currentService?serializeWeeklyService(currentService):null;
  return <ServiceApp adminName={session.username} initialMembers={members.map(serializeMember)} initialAbsences={absences} initialTemplateName={template?.filename ?? null} initialSettings={settings ?? undefined} initialCurrentService={service} />;
}
