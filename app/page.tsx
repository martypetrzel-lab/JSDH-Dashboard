import { requireAdmin } from '@/lib/auth';
import { serializeMember, type AbsenceRow, type RecurringAbsenceRow } from '@/lib/member-data';
import { getPrisma } from '@/lib/prisma';
import { serializeWeeklyService } from '@/lib/weekly-service-data';
import { serializeDriverActivity, serializeDtActivity } from '@/lib/conditioning-data';
import type { ConditioningData } from '@/lib/conditioning';
import { ServiceApp } from './service-app';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await requireAdmin();
  const prisma = getPrisma();
  const now = new Date();
  const [members, unavailability, recurringUnavailability, template, settings, currentService] = await Promise.all([
    prisma.member.findMany({ where: { active: true, systemAccount: false }, include:{dtActivities:{orderBy:{date:'desc'}},driverActivities:{orderBy:{date:'desc'}}}, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.unavailability.findMany({ include: { member: true }, orderBy: { from: 'asc' } }),
    prisma.recurringUnavailability.findMany({where:{active:true},include:{member:true},orderBy:{anchorStart:'asc'}}),
    prisma.medicalTemplate.findUnique({ where: { id: 'current' }, select: { filename: true } }),
    prisma.settings.findUnique({ where: { id: 'default' }, select: { weekStartDay: true, weekStartHour: true, weekEndDay: true, weekEndHour: true, minimumDt: true, conditioningWarningDays:true, timezone: true } }),
    prisma.weeklyService.findFirst({ where: { status: { in: ['DRAFT','CONFIRMED'] }, weekStart: { lte: new Date(now.getTime()+7*86400000) }, weekEnd: { gt: now } }, include: { assignments: { orderBy: [{ role: 'asc' }, { slot: 'asc' }] }, replacements:{include:{originalMember:true,replacementMember:true},orderBy:{from:'asc'}} }, orderBy: { weekStart: 'asc' } }),
  ]);
  const absences: AbsenceRow[] = unavailability.map((item) => ({
    id: item.id,
    memberId: item.memberId,
    member: `${item.member.firstName} ${item.member.lastName}`,
    from: item.from.toISOString(),
    to: item.to.toISOString(),
    reason: item.reason ?? '',
    label: 'Nedostupnost',
  }));
  const service=currentService?serializeWeeklyService(currentService):null;
  const recurringAbsences:RecurringAbsenceRow[]=recurringUnavailability.map(item=>({id:item.id,memberId:item.memberId,member:`${item.member.firstName} ${item.member.lastName==='—'?'':item.member.lastName}`.trim(),anchorStart:item.anchorStart.toISOString(),durationMinutes:item.durationMinutes,intervalMinutes:item.intervalMinutes,reason:item.reason??''}));
  const conditioning:ConditioningData={members:members.map(member=>({id:member.id,name:`${member.firstName} ${member.lastName==='—'?'':member.lastName}`.trim(),dt:member.dt,canDrive:member.canDrive})),dtActivities:members.flatMap(member=>member.dtActivities.map(serializeDtActivity)),driverActivities:members.flatMap(member=>member.driverActivities.map(serializeDriverActivity)),warningDays:settings?.conditioningWarningDays??30};
  const buildId=(process.env.RAILWAY_GIT_COMMIT_SHA??process.env.GIT_COMMIT_SHA??'local').slice(0,7);
  return <ServiceApp buildId={buildId} adminName={session.username} initialMembers={members.map(serializeMember)} initialAbsences={absences} initialRecurringAbsences={recurringAbsences} initialTemplateName={template?.filename ?? null} initialSettings={settings ?? undefined} initialCurrentService={service} initialConditioning={conditioning} />;
}
