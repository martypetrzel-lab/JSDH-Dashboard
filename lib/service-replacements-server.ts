import { getPrisma } from "./prisma";
import { DEFAULT_SERVICE_SETTINGS, planTemporaryCrews, unresolvedRecurringReplacements, type Assignment, type Role } from "./service";
import { toPlanningCandidates } from "./service-candidates";

export async function syncServiceReplacements(serviceId: string) {
  const prisma = getPrisma();
  const [service, settings, members, history] = await Promise.all([
    prisma.weeklyService.findUnique({ where: { id: serviceId }, include: { assignments: true, replacements: { where: { source: "MANUAL" } } } }),
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.member.findMany({ include: { unavailability: true, recurringUnavailability: { where: { active: true } } } }),
    prisma.weeklyServiceAssignment.findMany({ where: { service: { status: { in: ["CONFIRMED", "DRAFT"] } } }, select: { memberId: true, role: true, service: { select: { weekStart: true } } } }),
  ]);
  if (!service) throw new Error("Služba nebyla nalezena.");
  const candidates = toPlanningCandidates(members, history, service.weekStart).map((candidate) => ({
    ...candidate,
    unavailable: [...(candidate.unavailable ?? []), ...service.replacements.filter((item) => item.valid && item.replacementMemberId === candidate.id).map((item) => ({ from: item.from, to: item.to }))],
    recurringUnavailable: members.find((member) => member.id === candidate.id)?.recurringUnavailability.map((rule) => ({ anchorStart: rule.anchorStart, durationMinutes: rule.durationMinutes, intervalMinutes: rule.intervalMinutes })) ?? [],
  }));
  const assignments = service.assignments.map((item) => ({ assignmentId: item.id, slot: item.slot, role: item.role as Role, member: candidates.find((member) => member.id === item.memberId)!, mode: item.selectionMode })) satisfies (Assignment & { assignmentId: string; slot: number })[];
  const coverage = planTemporaryCrews(assignments, candidates, service.weekStart, service.weekEnd, settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt);
  const invalid = unresolvedRecurringReplacements(coverage.diagnostic);
  await prisma.$transaction(async (tx) => {
    await tx.serviceReplacement.deleteMany({ where: { serviceId, source: "RECURRING" } });
    await tx.serviceTemporaryAssignment.deleteMany({ where: { serviceId, source: "RECURRING" } });
    if (invalid.length) await tx.serviceReplacement.createMany({ data: invalid.map((item) => ({ ...item, serviceId, source: "RECURRING" })) });
    const rows = coverage.plans.flatMap((plan) => plan.assignments.map((item) => ({ serviceId, from: plan.from, to: plan.to, role: item.role, slot: item.slot, memberId: item.member.id, originalAssignmentId: item.assignmentId, source: "RECURRING" as const, reason: "Pracovní směna 24/48" })));
    if (rows.length) await tx.serviceTemporaryAssignment.createMany({ data: rows });
    const unresolvedIssue = invalid.length
      ? `${invalid[0].from.toLocaleString("cs-CZ", { timeZone: settings?.timezone ?? "Europe/Prague" })}–${invalid[0].to.toLocaleString("cs-CZ", { timeZone: settings?.timezone ?? "Europe/Prague" })}: nepodařilo se automaticky sestavit náhradní posádku.`
      : null;
    await tx.weeklyService.update({
      where: { id: serviceId },
      data: invalid.length
        ? { needsCrewChange: true, crewIssue: unresolvedIssue }
        : service.crewIssue?.includes("nepodařilo se automaticky sestavit náhradní posádku")
          ? { needsCrewChange: false, crewIssue: null }
          : {},
    });
    await tx.auditLog.create({ data: { action: rows.length ? "TEMP_CREW_CREATED" : "REPLACEMENTS_RECALCULATED", entity: "WeeklyService", entityId: serviceId, description: `Dočasné posádky byly přepočítány; intervalů: ${coverage.plans.length}, pozic: ${rows.length}.`, actor: "Systém" } });
  });
  return [...service.replacements, ...invalid];
}
