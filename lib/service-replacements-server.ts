import { getPrisma } from "./prisma";
import {
  DEFAULT_SERVICE_SETTINGS,
  planCoveredSegments,
  type Assignment,
  type Role,
} from "./service";
import { toPlanningCandidates } from "./service-candidates";

export async function syncServiceReplacements(serviceId: string) {
  const prisma = getPrisma(),
    [service, settings, members, history] = await Promise.all([
      prisma.weeklyService.findUnique({
        where: { id: serviceId },
        include: {
          assignments: true,
          replacements: { where: { source: "MANUAL" } },
        },
      }),
      prisma.settings.findUnique({ where: { id: "default" } }),
      prisma.member.findMany({
        include: {
          unavailability: true,
          recurringUnavailability: { where: { active: true } },
        },
      }),
      prisma.weeklyServiceAssignment.findMany({
        where: { service: { status: { in: ["CONFIRMED", "DRAFT"] } } },
        select: {
          memberId: true,
          role: true,
          service: { select: { weekStart: true } },
        },
      }),
    ]);
  if (!service) throw new Error("Služba nebyla nalezena.");
  const baseCandidates = toPlanningCandidates(
      members,
      history,
      service.weekStart,
    ).map((candidate) => ({
      ...candidate,
      recurringUnavailable:
        members
          .find((member) => member.id === candidate.id)
          ?.recurringUnavailability.map((rule) => ({
            anchorStart: rule.anchorStart,
            durationMinutes: rule.durationMinutes,
            intervalMinutes: rule.intervalMinutes,
          })) ?? [],
    })),
    assignments = service.assignments.map((item) => ({
      assignmentId: item.id,
      role: item.role as Role,
      member: baseCandidates.find((member) => member.id === item.memberId)!,
      mode: item.selectionMode,
    })) satisfies (Assignment & { assignmentId: string })[],
    coverage = planCoveredSegments(
      assignments,
      baseCandidates,
      service.weekStart,
      service.weekEnd,
      settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt,
    ),
    planned = (
      coverage.diagnostic
        ? [
            {
              assignmentId:
                assignments.find(
                  (item) => item.role === coverage.diagnostic!.missingRole,
                )?.assignmentId ?? assignments[0].assignmentId,
              originalMemberId:
                assignments.find(
                  (item) => item.role === coverage.diagnostic!.missingRole,
                )?.member.id ?? assignments[0].member.id,
              replacementMemberId: null,
              role: coverage.diagnostic.missingRole,
              from: coverage.diagnostic.from,
              to: coverage.diagnostic.to,
              valid: false,
              issue: "Nenalezen vhodný náhradník.",
            },
          ]
        : coverage.replacements
    ).map((item) =>
      service.replacements.some(
        (saved) =>
          saved.replacementMemberId &&
          saved.replacementMemberId === item.replacementMemberId &&
          saved.from < item.to &&
          item.from < saved.to,
      )
        ? {
            ...item,
            replacementMemberId: null,
            valid: false,
            issue: "Náhradník již v tomto čase zajišťuje jiný záskok.",
          }
        : item,
    );
  await prisma.$transaction(async (tx) => {
    await tx.serviceReplacement.deleteMany({
      where: { serviceId, source: "RECURRING" },
    });
    if (planned.length)
      await tx.serviceReplacement.createMany({
        data: planned.map((item) => ({
          ...item,
          serviceId,
          source: "RECURRING",
        })),
      });
    await tx.auditLog.create({
      data: {
        action: "REPLACEMENTS_RECALCULATED",
        entity: "WeeklyService",
        entityId: serviceId,
        description: `Časové záskoky byly přepočítány; intervalů: ${planned.length}.`,
        actor: "Systém",
      },
    });
  });
  return [...service.replacements, ...planned];
}
