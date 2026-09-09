import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminApi } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import { DEFAULT_SERVICE_SETTINGS, validateBaseCrewForCoverage, type Assignment, type Candidate, type Role } from '@/lib/service';
import { syncServiceReplacements } from '@/lib/service-replacements-server';
import { serializeWeeklyService } from '@/lib/weekly-service-data';

export const runtime = 'nodejs';

const inputSchema = z.object({
  allowUnresolvedReplacements: z.boolean().optional().default(false),
});
const serviceInclude = {
  assignments: { orderBy: [{ role: 'asc' as const }, { slot: 'asc' as const }] },
  replacements: { include: { originalMember: true, replacementMember: true }, orderBy: { from: 'asc' as const } },
};
const memberName = (member: { firstName: string; lastName: string }) =>
  `${member.firstName} ${member.lastName === '—' ? '' : member.lastName}`.trim();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: 'Nepřihlášený přístup.' }, { status: 401 });
  try {
    const { id } = await context.params;
    const input = inputSchema.parse(await request.json().catch(() => ({})));
    const prisma = getPrisma();
    const [service, settings] = await Promise.all([
      prisma.weeklyService.findUnique({ where: { id }, include: { assignments: { include: { member: { include: { unavailability: true, recurringUnavailability: { where: { active: true } } } } }, orderBy: [{ role: 'asc' }, { slot: 'asc' }] } } }),
      prisma.settings.findUnique({ where: { id: 'default' } }),
    ]);
    if (!service) return NextResponse.json({ error: 'Služba nebyla nalezena.' }, { status: 404 });
    if (service.status === 'CANCELLED') return NextResponse.json({ error: 'Zrušenou službu nelze potvrdit.' }, { status: 409 });

    const minimumDt = settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt;
    const assignments: Assignment[] = service.assignments.map((item) => {
      const member = item.member;
      const candidate: Candidate = {
        id: member.id,
        name: memberName(member),
        active: member.active,
        system: member.systemAccount,
        reserveOnly: member.reserveOnly,
        dt: member.dt,
        medicalExam: member.medicalExamAt,
        medicalValidUntil: member.medicalValidUntil,
        roles: [member.canCommand && 'COMMANDER', member.canDrive && 'DRIVER', member.canFight && 'FIREFIGHTER'].filter(Boolean) as Role[],
        serviceCount: 0,
        lastService: null,
        unavailable: member.unavailability.map((unavailable) => ({ from: unavailable.from, to: unavailable.to })),
        recurringUnavailable: member.recurringUnavailability.map((rule) => ({ anchorStart: rule.anchorStart, durationMinutes: rule.durationMinutes, intervalMinutes: rule.intervalMinutes })),
      };
      return { role: item.role as Role, member: candidate, mode: item.selectionMode };
    });
    const validation = validateBaseCrewForCoverage(assignments, service.weekStart, service.weekEnd, minimumDt);
    if (!validation.valid) return NextResponse.json({ error: validation.errors.join('\n') }, { status: 422 });

    await syncServiceReplacements(id);
    const unresolved = await prisma.serviceReplacement.findMany({
      where: { serviceId: id, valid: false },
      include: { originalMember: true },
      orderBy: [{ from: 'asc' }, { role: 'asc' }],
    });
    if (unresolved.length && !input.allowUnresolvedReplacements) {
      return NextResponse.json({
        requiresOverrideConfirmation: true,
        warning: 'Služba obsahuje nevyřešený záskok.',
        unresolvedReplacements: unresolved.map((item) => ({
          id: item.id,
          assignmentId: item.assignmentId,
          originalMemberId: item.originalMemberId,
          originalName: memberName(item.originalMember),
          role: item.role,
          from: item.from.toISOString(),
          to: item.to.toISOString(),
          valid: false,
          issue: item.issue,
        })),
      }, { status: 409 });
    }

    const confirmedWithUnresolved = unresolved.length > 0;
    await prisma.$transaction([
      prisma.weeklyService.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          action: confirmedWithUnresolved ? 'WEEK_CONFIRMED_WITH_UNRESOLVED_REPLACEMENT' : 'WEEK_CONFIRMED',
          entity: 'WeeklyService',
          entityId: id,
          description: confirmedWithUnresolved
            ? 'Týdenní služba byla administrátorem potvrzena i přes nevyřešený záskok.'
            : 'Týdenní posádka byla potvrzena.',
          actor: 'Administrátor',
        },
      }),
    ]);
    const confirmed = await prisma.weeklyService.findUniqueOrThrow({ where: { id }, include: serviceInclude });
    return NextResponse.json({ service: serializeWeeklyService(confirmed), confirmedWithUnresolved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Službu se nepodařilo potvrdit.' }, { status: 400 });
  }
}
