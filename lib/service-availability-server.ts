import { getPrisma } from "@/lib/prisma";
import { hardUnavailabilityIssue } from "@/lib/service";

const ACTIVE_SERVICE_STATUSES = ["DRAFT", "CONFIRMED"] as const;

export async function refreshHardUnavailabilityForMembers(memberIds: string[]) {
  const uniqueMemberIds = [...new Set(memberIds.filter(Boolean))];
  if (!uniqueMemberIds.length) return [];

  const prisma = getPrisma();
  const services = await prisma.weeklyService.findMany({
    where: {
      status: { in: [...ACTIVE_SERVICE_STATUSES] },
      assignments: { some: { memberId: { in: uniqueMemberIds } } },
    },
    include: {
      assignments: {
        include: { member: { include: { unavailability: true } } },
      },
    },
  });

  const affectedIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const service of services) {
      const crewIssue = hardUnavailabilityIssue(
        service.assignments.map((assignment) => ({
          name: assignment.nameSnapshot,
          unavailable: assignment.member.unavailability,
        })),
        service.weekStart,
        service.weekEnd,
      );
      const needsCrewChange = crewIssue !== null;

      await tx.weeklyService.update({
        where: { id: service.id },
        data: { needsCrewChange, crewIssue },
      });
      if (needsCrewChange) affectedIds.push(service.id);
      if (
        needsCrewChange &&
        (!service.needsCrewChange || service.crewIssue !== crewIssue)
      ) {
        await tx.auditLog.create({
          data: {
            action: "SERVICE_REQUIRES_CREW_CHANGE",
            entity: "WeeklyService",
            entityId: service.id,
            description: `${crewIssue} Služba nebyla automaticky změněna.`,
            actor: "Administrátor",
          },
        });
      }
    }
  });

  return affectedIds;
}
