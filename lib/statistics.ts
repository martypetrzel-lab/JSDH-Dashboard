import type { Role } from "./service";

export type StatisticsMember = { id: string; name: string; active: boolean; dt: boolean };
export type StatisticsAssignment = {
  memberId: string;
  role: Role;
  service: { id: string; weekStart: Date; weekEnd: Date; status: string };
};
export type StatisticsReplacement = {
  replacementMemberId: string | null;
  role: Role;
  from: Date;
  to: Date;
  valid: boolean;
  service: { id: string; weekStart: Date; status: string };
};
type RoleCounts = Record<Role, number>;
const emptyRoles = (): RoleCounts => ({ COMMANDER: 0, DRIVER: 0, FIREFIGHTER: 0 });
export const baseServiceCategory = (status: string, weekStart: Date, now: Date): "SERVED" | "PLANNED" | null =>
  weekStart < now ? status === "CONFIRMED" ? "SERVED" : null : status === "DRAFT" || status === "CONFIRMED" ? "PLANNED" : null;
const countedService = (status: string, weekStart: Date, now: Date) => baseServiceCategory(status, weekStart, now) !== null;

export function memberServiceStatistics(
  members: StatisticsMember[],
  assignments: StatisticsAssignment[],
  replacements: StatisticsReplacement[],
  now = new Date(),
) {
  const rows = members.map((member) => {
    const base = assignments.filter((item) => item.memberId === member.id && countedService(item.service.status, item.service.weekStart, now));
    const servedAssignments = base.filter((item) => item.service.weekStart < now && item.service.status === "CONFIRMED");
    const plannedAssignments = base.filter((item) => item.service.weekStart >= now && (item.service.status === "DRAFT" || item.service.status === "CONFIRMED"));
    const servedRoles = emptyRoles(), plannedRoles = emptyRoles();
    for (const item of servedAssignments) servedRoles[item.role] += 1;
    for (const item of plannedAssignments) plannedRoles[item.role] += 1;
    const memberReplacements = replacements.filter((item) =>
      item.valid && item.replacementMemberId === member.id && countedService(item.service.status, item.service.weekStart, now),
    );
    const served = servedAssignments.length, planned = plannedAssignments.length;
    return {
      ...member,
      served,
      servedRoles,
      planned,
      plannedRoles,
      total: served + planned,
      lastServedAt: servedAssignments.length ? new Date(Math.max(...servedAssignments.map((item) => item.service.weekStart.getTime()))) : null,
      nextPlannedAt: plannedAssignments.length ? new Date(Math.min(...plannedAssignments.map((item) => item.service.weekStart.getTime()))) : null,
      replacementCount: memberReplacements.length,
      replacementHours: memberReplacements.reduce((sum, item) => sum + (item.to.getTime() - item.from.getTime()) / 3600000, 0),
      servedDetail: servedAssignments.sort((a, b) => a.service.weekStart.getTime() - b.service.weekStart.getTime()).map((item) => ({ serviceId: item.service.id, from: item.service.weekStart, to: item.service.weekEnd, role: item.role })),
      plannedDetail: plannedAssignments.sort((a, b) => a.service.weekStart.getTime() - b.service.weekStart.getTime()).map((item) => ({ serviceId: item.service.id, from: item.service.weekStart, to: item.service.weekEnd, role: item.role })),
      replacementDetail: memberReplacements.sort((a, b) => a.from.getTime() - b.from.getTime()).map((item) => ({ serviceId: item.service.id, from: item.from, to: item.to, role: item.role })),
    };
  });
  const average = rows.length ? rows.reduce((sum, row) => sum + row.total, 0) / rows.length : 0;
  return rows.map((row) => ({ ...row, differenceFromAverage: row.total - average }));
}

export function statisticsSummary(rows: ReturnType<typeof memberServiceStatistics>, assignments: StatisticsAssignment[], now = new Date()) {
  const servedServices = new Set(assignments.filter((item) => item.service.status === "CONFIRMED" && item.service.weekStart < now).map((item) => item.service.id)).size;
  const plannedServices = new Set(assignments.filter((item) => item.service.weekStart >= now && (item.service.status === "DRAFT" || item.service.status === "CONFIRMED")).map((item) => item.service.id)).size;
  const totals = rows.map((row) => row.total);
  return {
    servedServices,
    plannedServices,
    activeMembers: rows.filter((row) => row.active).length,
    largestDifference: totals.length ? Math.max(...totals) - Math.min(...totals) : 0,
    minimumServices: totals.length ? Math.min(...totals) : 0,
    maximumServices: totals.length ? Math.max(...totals) : 0,
  };
}
