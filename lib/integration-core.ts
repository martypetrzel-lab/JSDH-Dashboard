import { createHash, timingSafeEqual } from "node:crypto";

export const INTEGRATION_API_VERSION = 1 as const;
export const INTEGRATION_TIMEZONE = "Europe/Prague" as const;
const safeEqual = (actual: string, expected: string) => timingSafeEqual(createHash("sha256").update(actual, "utf8").digest(), createHash("sha256").update(expected, "utf8").digest());

export function integrationAuthorized(request: Request) {
  const expected = process.env.INTEGRATION_API_KEY?.trim();
  const header = request.headers.get("authorization") ?? "";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  return supplied.length > 0 && safeEqual(supplied, expected);
}
export const integrationMemberName = (member: { firstName: string; lastName: string }) => `${member.firstName} ${member.lastName === "—" ? "" : member.lastName}`.trim();
type IntegrationAssignment = { id: string; memberId: string; role: string; slot: number; nameSnapshot: string; dtSnapshot: boolean };
type IntegrationReplacement = { id: string; assignmentId: string; originalMemberId: string; replacementMemberId: string | null; role: string; from: Date; to: Date; valid: boolean; issue: string | null; reason: string | null; source: string; originalMember: { firstName: string; lastName: string }; replacementMember: { firstName: string; lastName: string; dt: boolean } | null };
type IntegrationTemporaryAssignment = { id: string; from: Date; to: Date; role: string; slot: number; memberId: string; originalAssignmentId: string | null; member: { firstName: string; lastName: string; dt: boolean } };
export type IntegrationServiceSource = { id: string; status: string; weekStart: Date; weekEnd: Date; needsCrewChange: boolean; crewIssue: string | null; assignments: IntegrationAssignment[]; replacements: IntegrationReplacement[]; temporaryAssignments?: IntegrationTemporaryAssignment[] };
export function serializeIntegrationCrew(assignments: IntegrationAssignment[]) { return assignments.map((item) => ({ assignmentId: item.id, memberId: item.memberId, name: item.nameSnapshot, role: item.role, slot: item.slot, dt: item.dtSnapshot })); }
export function serializeIntegrationReplacements(replacements: IntegrationReplacement[]) { return replacements.map((item) => ({ id: item.id, assignmentId: item.assignmentId, originalMemberId: item.originalMemberId, originalName: integrationMemberName(item.originalMember), replacementMemberId: item.replacementMemberId, replacementName: item.replacementMember ? integrationMemberName(item.replacementMember) : null, role: item.role, from: item.from.toISOString(), to: item.to.toISOString(), valid: item.valid, issue: item.issue, reason: item.reason, source: item.source })); }
export function effectiveIntegrationCrew(service: IntegrationServiceSource, at: Date) {
  const temporary = (service.temporaryAssignments ?? []).filter((item) => item.from <= at && at < item.to);
  if (temporary.length === 4 && new Set(temporary.map((item) => item.memberId)).size === 4) return temporary.map((item) => {
    const base = service.assignments.find((assignment) => assignment.id === item.originalAssignmentId);
    return { assignmentId: item.originalAssignmentId ?? item.id, memberId: item.memberId, name: integrationMemberName(item.member), role: item.role, slot: item.slot, dt: item.member.dt, baseMemberId: base?.memberId ?? null, baseName: base?.nameSnapshot ?? null, replacingMemberId: base?.memberId === item.memberId ? null : item.memberId, replacingName: base?.memberId === item.memberId ? null : integrationMemberName(item.member) };
  });
  return service.assignments.map((assignment) => { const replacement = service.replacements.find((item) => item.assignmentId === assignment.id && item.valid && item.replacementMemberId && item.from <= at && at < item.to); return { assignmentId: assignment.id, memberId: replacement?.replacementMemberId ?? assignment.memberId, name: replacement?.replacementMember ? integrationMemberName(replacement.replacementMember) : assignment.nameSnapshot, role: assignment.role, slot: assignment.slot, dt: replacement?.replacementMember?.dt ?? assignment.dtSnapshot, baseMemberId: assignment.memberId, baseName: assignment.nameSnapshot, replacingMemberId: replacement?.replacementMemberId ?? null, replacingName: replacement?.replacementMember ? integrationMemberName(replacement.replacementMember) : null }; });
}
export function serializeIntegrationService(service: IntegrationServiceSource) { return { id: service.id, status: service.status, from: service.weekStart.toISOString(), to: service.weekEnd.toISOString(), crew: serializeIntegrationCrew(service.assignments), replacements: serializeIntegrationReplacements(service.replacements), needsCrewChange: service.needsCrewChange, crewIssue: service.crewIssue }; }
export function selectCurrentConfirmedService<T extends { status: string; weekStart: Date; weekEnd: Date }>(services: T[], now: Date) { return services.find((service) => service.status === "CONFIRMED" && service.weekStart <= now && now < service.weekEnd) ?? null; }
export function selectNextConfirmedService<T extends { status: string; weekStart: Date }>(services: T[], now: Date) { return services.filter((service) => service.status === "CONFIRMED" && service.weekStart > now).sort((left, right) => left.weekStart.getTime() - right.weekStart.getTime())[0] ?? null; }
export const validIntegrationMonth = (month: string | null) => !!month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
