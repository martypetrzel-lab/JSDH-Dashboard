export type DashboardReplacement = {
  id: string;
  assignmentId: string;
  originalMemberId: string;
  originalName: string;
  replacementMemberId: string | null;
  replacementName: string | null;
  roleKey: 'COMMANDER' | 'DRIVER' | 'FIREFIGHTER';
  from: string;
  to: string;
  valid: boolean;
  issue: string | null;
  reason: string | null;
  source: 'RECURRING' | 'MANUAL';
};

export type DashboardService = {
  id: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  from: string;
  to: string;
  cancellationReason: string | null;
  needsCrewChange: boolean;
  crewIssue: string | null;
  crew: {
    assignmentId: string;
    memberId: string;
    role: 'Velitel' | 'Strojník' | 'Hasič';
    roleKey: 'COMMANDER' | 'DRIVER' | 'FIREFIGHTER';
    slot: number;
    name: string;
    tag: string;
    dt: boolean;
  }[];
  replacements: DashboardReplacement[];
};

type SerializableService = {
  id: string;
  status: string;
  weekStart: Date;
  weekEnd: Date;
  cancellationReason?: string | null;
  needsCrewChange?: boolean;
  crewIssue?: string | null;
  assignments: { id: string; memberId: string; role: string; slot: number; nameSnapshot: string; dtSnapshot: boolean }[];
  replacements?: {
    id: string;
    assignmentId: string;
    originalMemberId: string;
    replacementMemberId: string | null;
    role: string;
    from: Date;
    to: Date;
    valid: boolean;
    issue: string | null;
    reason?: string | null;
    source?: string;
    originalMember: { firstName: string; lastName: string };
    replacementMember: { firstName: string; lastName: string } | null;
  }[];
};

const memberName = (member: { firstName: string; lastName: string }) =>
  `${member.firstName} ${member.lastName === '—' ? '' : member.lastName}`.trim();

export function serializeWeeklyService(service: SerializableService): DashboardService {
  return {
    id: service.id,
    status: service.status === 'CONFIRMED' ? 'CONFIRMED' : service.status === 'CANCELLED' ? 'CANCELLED' : 'DRAFT',
    from: service.weekStart.toISOString(),
    to: service.weekEnd.toISOString(),
    cancellationReason: service.cancellationReason ?? null,
    needsCrewChange: service.needsCrewChange ?? false,
    crewIssue: service.crewIssue ?? null,
    crew: service.assignments.map((assignment) => ({
      assignmentId: assignment.id,
      memberId: assignment.memberId,
      role: assignment.role === 'COMMANDER' ? 'Velitel' : assignment.role === 'DRIVER' ? 'Strojník' : 'Hasič',
      roleKey: assignment.role as 'COMMANDER' | 'DRIVER' | 'FIREFIGHTER',
      slot: assignment.slot,
      name: assignment.nameSnapshot,
      tag: assignment.role === 'COMMANDER' ? 'VD' : assignment.role === 'DRIVER' ? 'ST' : 'H',
      dt: assignment.dtSnapshot,
    })),
    replacements: (service.replacements ?? []).map((item) => ({
      id: item.id,
      assignmentId: item.assignmentId,
      originalMemberId: item.originalMemberId,
      originalName: memberName(item.originalMember),
      replacementMemberId: item.replacementMemberId,
      replacementName: item.replacementMember ? memberName(item.replacementMember) : null,
      roleKey: item.role as 'COMMANDER' | 'DRIVER' | 'FIREFIGHTER',
      from: item.from.toISOString(),
      to: item.to.toISOString(),
      valid: item.valid,
      issue: item.issue,
      reason: item.reason ?? null,
      source: item.source === 'MANUAL' ? 'MANUAL' : 'RECURRING',
    })),
  };
}
