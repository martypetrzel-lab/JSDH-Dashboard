import { getPrisma } from "./prisma";
import {
  DEFAULT_SERVICE_SETTINGS,
  intervalsOverlap,
  planCoveredSegments,
  type Assignment,
  type Role,
} from "./service";
import { toPlanningCandidates } from "./service-candidates";

/** Rebuild only interval replacements; never rearrange the base crew. */
export async function syncServiceReplacements(serviceId: string) {
  const prisma = getPrisma();
  const [service, settings, members, history] = await Promise.all([
    prisma.weeklyService.findUnique({
      where: { id: serviceId },
      include: { assignments: true, replacements: { where: { source: "MANUAL" } } },
    }),
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.member.findMany({ include: { unavailability: true, recurringUnavailability: { where: { active: true } } } }),
    prisma.weeklyServiceAssignment.findMany({
      where: { service: { status: { in: ["CONFIRMED", "DRAFT"] } } },
      select: { memberId: true, role: true, service: { select: { weekStart: true, status: true } } },
    }),
  ]);
  if (!service) throw new Error("Služba nebyla nalezena.");

  const candidates = toPlanningCandidates(members, history, service.weekStart).map((candidate) => ({
    ...candidate,
    unavailable: [
      ...(candidate.unavailable ?? []),
      ...service.replacements
        .filter((item) => item.valid && item.replacementMemberId === candidate.id)
        .map((item) => ({ from: item.from, to: item.to })),
    ],
    recurringUnavailable: members.find((member) => member.id === candidate.id)?.recurringUnavailability.map((rule) => ({
      anchorStart: rule.anchorStart,
      durationMinutes: rule.durationMinutes,
      intervalMinutes: rule.intervalMinutes,
    })) ?? [],
  }));
  const assignments = service.assignments.map((item) => ({
    assignmentId: item.id,
    role: item.role as Role,
    member: candidates.find((member) => member.id === item.memberId)!,
    mode: item.selectionMode,
  })) satisfies (Assignment & { assignmentId: string })[];
  const coverage = planCoveredSegments(
    assignments,
    candidates,
    service.weekStart,
    service.weekEnd,
    settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt,
  );
  const automatic = coverage.replacements.flatMap((item) => {
    let remaining = [{ from: item.from, to: item.to }];
    for (const manual of service.replacements.filter((candidate) =>
      candidate.assignmentId === item.assignmentId && intervalsOverlap(candidate.from, candidate.to, item.from, item.to),
    )) {
      remaining = remaining.flatMap((part) => {
        if (!intervalsOverlap(part.from, part.to, manual.from, manual.to)) return [part];
        return [
          ...(part.from < manual.from ? [{ from: part.from, to: manual.from }] : []),
          ...(manual.to < part.to ? [{ from: manual.to, to: part.to }] : []),
        ];
      });
    }
    return remaining.map((part) => ({ ...item, ...part }));
  });
  const invalid = [
    ...service.replacements.filter((item) => !item.valid),
    ...automatic.filter((item) => !item.valid),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.serviceReplacement.deleteMany({ where: { serviceId, source: "RECURRING" } });
    await tx.serviceTemporaryAssignment.deleteMany({ where: { serviceId } });
    if (automatic.length) {
      await tx.serviceReplacement.createMany({
        data: automatic.map((item) => ({ ...item, serviceId, source: "RECURRING" })),
      });
    }
    const unresolvedIssue = invalid.length
      ? `${invalid[0].from.toLocaleString("cs-CZ", { timeZone: settings?.timezone ?? "Europe/Prague" })}–${invalid[0].to.toLocaleString("cs-CZ", { timeZone: settings?.timezone ?? "Europe/Prague" })}: nenalezen vhodný náhradník.`
      : null;
    await tx.weeklyService.update({
      where: { id: serviceId },
      data: invalid.length
        ? { needsCrewChange: true, crewIssue: unresolvedIssue }
        : service.crewIssue?.includes("nenalezen vhodný náhradník") || service.crewIssue?.includes("nepodařilo se automaticky sestavit náhradní posádku")
          ? { needsCrewChange: false, crewIssue: null }
          : {},
    });
    await tx.auditLog.create({
      data: {
        action: "REPLACEMENTS_RECALCULATED",
        entity: "WeeklyService",
        entityId: serviceId,
        description: `Časové záskoky byly přepočítány; intervalů: ${automatic.length}, nevyřešených: ${invalid.length}.`,
        actor: "Systém",
      },
    });
  });
  return [...service.replacements, ...automatic];
}
