export type Role = "COMMANDER" | "DRIVER" | "FIREFIGHTER";
export type Candidate = {
  id: string;
  name: string;
  active: boolean;
  system: boolean;
  reserveOnly: boolean;
  dt: boolean;
  medicalExam: Date | null;
  medicalValidUntil?: Date | null;
  roles: Role[];
  serviceCount: number;
  roleServiceCount?: Partial<Record<Role, number>>;
  lastService: Date | null;
  servedPreviousWeek?: boolean;
  unavailable?: { from: Date; to: Date }[];
  recurringUnavailable?: RecurringRule[];
};
export type RecurringRule = {
  anchorStart: Date;
  durationMinutes: number;
  intervalMinutes: number;
};
export type Assignment = {
  role: Role;
  member: Candidate;
  mode: "AUTO" | "MANUAL";
};
export type ServiceTimeSettings = {
  weekStartDay: number;
  weekStartHour: number;
  weekEndDay: number;
  weekEndHour: number;
  minimumDt: number;
  timezone: string;
};
export type FairnessSettings = {
  fairDraw: boolean;
  considerTotal: boolean;
  considerRole: boolean;
  preferRested: boolean;
  allowConsecutive: boolean;
};

export const DEFAULT_SERVICE_SETTINGS: ServiceTimeSettings = {
  weekStartDay: 1,
  weekStartHour: 6,
  weekEndDay: 1,
  weekEndHour: 6,
  minimumDt: 1,
  timezone: "Europe/Prague",
};
export const DEFAULT_FAIRNESS_SETTINGS: FairnessSettings = {
  fairDraw: true,
  considerTotal: true,
  considerRole: true,
  preferRested: true,
  allowConsecutive: true,
};
export const MISSING_DT_ERROR =
  "Pro tento časový interval nelze sestavit platnou posádku.\nChybí nositel dýchací techniky.";

export const canHardDeleteService = (
  status: "DRAFT" | "CONFIRMED" | "CANCELLED",
  confirmedAcknowledged = false,
) =>
  status === "DRAFT" ||
  ((status === "CONFIRMED" || status === "CANCELLED") &&
    confirmedAcknowledged);
export const canCancelService = (status: "DRAFT" | "CONFIRMED" | "CANCELLED") =>
  status !== "CANCELLED";
export function serviceDeletionAuditDescription(service: {
  from: Date;
  to: Date;
  status: string;
  crew: { role: string; name: string }[];
  replacementCount: number;
}) {
  return `Interval: ${service.from.toISOString()} → ${service.to.toISOString()}; stav před smazáním: ${service.status}; sestava: ${service.crew.map((item) => `${item.role}: ${item.name}`).join(", ")}; počet záskoků: ${service.replacementCount}.`;
}
export function removeServiceFromPlan<T extends { id: string }>(
  services: T[],
  deletedId: string,
) {
  return services.filter((service) => service.id !== deletedId);
}
export function servicesFromWeek<T extends { weekStart: Date }>(services:T[],from:Date){return services.filter(service=>service.weekStart>=from);}
export function futureRangeNeedsConfirmation(services:{status:string}[]){return services.some(service=>service.status==='CONFIRMED');}
export const emergencyReplacementEnd = (
  mode: "CUSTOM" | "UNTIL_END",
  selectedTo: Date,
  weekEnd: Date,
) => (mode === "UNTIL_END" ? weekEnd : selectedTo);

export type ServiceTimelineAssignment = {
  assignmentId: string;
  role: Role;
  memberId: string;
  name: string;
};
export type ServiceTimelineReplacement = {
  assignmentId: string;
  replacementMemberId: string | null;
  replacementName: string | null;
  from: Date;
  to: Date;
  valid: boolean;
};
export type ServiceTimelineTemporaryAssignment = {
  id: string;
  from: Date;
  to: Date;
  role: Role;
  slot: number;
  memberId: string;
  name: string;
  originalAssignmentId: string | null;
};
export function serviceTimeline(
  start: Date,
  end: Date,
  crew: ServiceTimelineAssignment[],
  replacements: ServiceTimelineReplacement[],
  temporaryAssignments: ServiceTimelineTemporaryAssignment[] = [],
) {
  const relevant = replacements.filter((item) =>
    intervalsOverlap(item.from, item.to, start, end),
  );
  const relevantTemporary = temporaryAssignments.filter((item) => intervalsOverlap(item.from, item.to, start, end));
  const boundaries = [
    start,
    ...relevant.flatMap((item) => [
      item.from < start ? start : item.from,
      item.to > end ? end : item.to,
    ]),
    ...relevantTemporary.flatMap((item) => [item.from < start ? start : item.from, item.to > end ? end : item.to]),
    end,
  ]
    .map((item) => item.getTime())
    .sort((a, b) => a - b);
  const unique = [...new Set(boundaries)];
  return unique.slice(0, -1).map((from, index) => {
    const to = unique[index + 1];
    return {
      from: new Date(from),
      to: new Date(to),
      crew: (() => {
        const temporary = relevantTemporary.filter((item) => item.from.getTime() <= from && item.to.getTime() >= to);
        if (temporary.length === 4 && new Set(temporary.map((item) => item.memberId)).size === 4) return temporary.map((item) => ({ assignmentId: item.originalAssignmentId ?? item.id, role: item.role, memberId: item.memberId, name: item.name, replaced: crew.find((base) => base.assignmentId === item.originalAssignmentId)?.memberId !== item.memberId, originalName: crew.find((base) => base.assignmentId === item.originalAssignmentId)?.name ?? null, unresolved: false }));
        return crew.map((item) => {
        const unresolved = relevant.find(
          (candidate) =>
            candidate.assignmentId === item.assignmentId &&
            !candidate.valid &&
            candidate.from.getTime() <= from &&
            candidate.to.getTime() >= to,
        );
        const replacement = relevant.find(
          (candidate) =>
            candidate.assignmentId === item.assignmentId &&
            candidate.valid &&
            candidate.replacementMemberId &&
            candidate.from.getTime() <= from &&
            candidate.to.getTime() >= to,
        );
        return {
          ...item,
          memberId: replacement?.replacementMemberId ?? item.memberId,
          name: replacement?.replacementName ?? item.name,
          replaced: !!replacement,
          originalName: replacement ? item.name : null,
          unresolved: !!unresolved,
        };
        });
      })(),
    };
  });
}

export function serviceOperationalState(
  status: "DRAFT" | "CONFIRMED" | "CANCELLED",
  crewValid: boolean,
  replacements: { valid: boolean }[],
  needsCrewChange = false,
) {
  if (status === "CANCELLED")
    return { kind: "cancelled" as const, label: "Zrušena" };
  if (replacements.some((item) => !item.valid))
    return { kind: "replacement" as const, label: "Vyžaduje záskok" };
  if (needsCrewChange)
    return { kind: "invalid" as const, label: "Vyžaduje změnu sestavy" };
  if (!crewValid)
    return { kind: "invalid" as const, label: "Neplatná sestava" };
  return status === "CONFIRMED"
    ? { kind: "confirmed" as const, label: "Potvrzena" }
    : { kind: "draft" as const, label: "Návrh" };
}

const zoneParts = (date: Date, timeZone = "Europe/Prague") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>(
      (result, part) => ((result[part.type] = part.value), result),
      {},
    );
const zoneOffsetMinutes = (date: Date, timeZone: string) => {
  const value =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(value);
  if (!match) return 0;
  return (
    (match[1] === "-" ? -1 : 1) *
    (Number(match[2]) * 60 + Number(match[3] ?? 0))
  );
};
const zonedDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  timeZone = "Europe/Prague",
) => {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(
    guess.getTime() - zoneOffsetMinutes(guess, timeZone) * 60000,
  );
  return new Date(guess.getTime() - zoneOffsetMinutes(first, timeZone) * 60000);
};
const shiftedDateParts = (
  year: number,
  month: number,
  day: number,
  days: number,
) => {
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
};

export function serviceWeek(
  reference: Date,
  settings: ServiceTimeSettings = DEFAULT_SERVICE_SETTINGS,
) {
  const parts = zoneParts(reference, settings.timezone),
    year = Number(parts.year),
    month = Number(parts.month),
    day = Number(parts.day);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday,
  );
  const startCalendar = shiftedDateParts(
    year,
    month,
    day,
    -((weekday - settings.weekStartDay + 7) % 7),
  );
  const start = zonedDate(
    startCalendar.year,
    startCalendar.month,
    startCalendar.day,
    settings.weekStartHour,
    0,
    settings.timezone,
  );
  const endCalendar = shiftedDateParts(
    startCalendar.year,
    startCalendar.month,
    startCalendar.day,
    7,
  );
  const end = zonedDate(
    endCalendar.year,
    endCalendar.month,
    endCalendar.day,
    settings.weekEndHour,
    0,
    settings.timezone,
  );
  return { start, end };
}
export function nextServiceWeek(
  reference: Date,
  settings: ServiceTimeSettings = DEFAULT_SERVICE_SETTINGS,
) {
  const current = serviceWeek(reference, settings);
  const parts = zoneParts(current.start, settings.timezone);
  const next = shiftedDateParts(
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    7,
  );
  const start = zonedDate(
    next.year,
    next.month,
    next.day,
    settings.weekStartHour,
    0,
    settings.timezone,
  );
  return serviceWeek(new Date(start.getTime() + 60000), settings);
}
export function planningServiceWeek(
  reference: Date,
  settings: ServiceTimeSettings = DEFAULT_SERVICE_SETTINGS,
) {
  const current = serviceWeek(reference, settings);
  return reference >= current.end
    ? nextServiceWeek(reference, settings)
    : current;
}
export function wholeDay(reference: Date, timeZone = "Europe/Prague") {
  const parts = zoneParts(reference, timeZone);
  const next = shiftedDateParts(
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    1,
  );
  return {
    start: zonedDate(
      Number(parts.year),
      Number(parts.month),
      Number(parts.day),
      0,
      0,
      timeZone,
    ),
    end: zonedDate(next.year, next.month, next.day, 0, 0, timeZone),
  };
}
export function toLocalDateTimeInput(date: Date, timeZone = "Europe/Prague") {
  const parts = zoneParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function fromLocalDateTimeInput(
  value: string,
  timeZone = "Europe/Prague",
) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return zonedDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    timeZone,
  );
}
export function formatServiceDateTime(date: Date, timeZone = "Europe/Prague") {
  const parts = zoneParts(date, timeZone);
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}
export function serviceMonthKey(date: Date, timeZone = "Europe/Prague") {
  const parts = zoneParts(date, timeZone);
  return `${parts.year}-${parts.month}`;
}
export function serviceWeeksForMonth(
  month: string,
  settings: ServiceTimeSettings = DEFAULT_SERVICE_SETTINGS,
) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Neplatný měsíc.");
  const reference = fromLocalDateTimeInput(
    `${month}-01T12:00`,
    settings.timezone,
  );
  if (!reference) throw new Error("Neplatný měsíc.");
  let interval = serviceWeek(reference, settings);
  if (serviceMonthKey(interval.start, settings.timezone) !== month)
    interval = nextServiceWeek(interval.start, settings);
  const result: { start: Date; end: Date }[] = [];
  while (serviceMonthKey(interval.start, settings.timezone) === month) {
    result.push(interval);
    interval = nextServiceWeek(interval.start, settings);
  }
  return result;
}

export const intervalsOverlap = (
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
) => aStart < bEnd && bStart < aEnd;
export function hardUnavailabilityIssue(
  members: { name: string; unavailable?: { from: Date; to: Date }[] }[],
  start: Date,
  end: Date,
) {
  const member = members.find((item) =>
    item.unavailable?.some((absence) =>
      intervalsOverlap(absence.from, absence.to, start, end),
    ),
  );
  return member ? `Člen ${member.name} je v tomto týdnu nedostupný.` : null;
}
export const medicalValidUntil = (exam: Date | null) =>
  exam
    ? new Date(
        exam.getFullYear() + 2,
        exam.getMonth(),
        exam.getDate(),
        23,
        59,
        59,
        999,
      )
    : null;
export const hasValidMedical = (member: Candidate, at: Date) => {
  const stored =
    member.medicalValidUntil === undefined
      ? medicalValidUntil(member.medicalExam)
      : member.medicalValidUntil;
  const until =
    stored && member.medicalValidUntil !== undefined
      ? new Date(stored.getTime() + 86400000 - 1)
      : stored;
  return !!until && until >= at;
};
export function eligibility(
  member: Candidate,
  role: Role,
  start: Date,
  end: Date,
  manual = false,
) {
  const reasons: string[] = [];
  if (!member.active) reasons.push("neaktivní člen");
  if (member.system) reasons.push("systémový účet");
  if (member.reserveOnly && !manual) reasons.push("pouze na počet");
  if (!member.roles.includes(role)) reasons.push("chybí oprávnění");
  if (!hasValidMedical(member, new Date(end.getTime() - 1)))
    reasons.push("neplatná zdravotní prohlídka");
  if (
    !manual &&
    member.unavailable?.some((unavailable) =>
      intervalsOverlap(unavailable.from, unavailable.to, start, end),
    )
  )
    reasons.push("nahlášená nedostupnost");
  return { eligible: reasons.length === 0, reasons };
}
export type ReplacementBlockingInterval = { type: "UNAVAILABILITY" | "RECURRING"; from: Date; to: Date };
export function getReplacementAvailability(member: Candidate, from: Date, to: Date) {
  const validDate = (value: Date) => value instanceof Date && !Number.isNaN(value.getTime());
  const blockingUnavailability = (member.unavailable ?? []).find((period) => validDate(period.from) && validDate(period.to) && intervalsOverlap(period.from, period.to, from, to)) ?? null;
  const blockingRecurring = (member.recurringUnavailable ?? []).flatMap((rule) => validDate(rule.anchorStart) && rule.durationMinutes > 0 && rule.intervalMinutes > 0 ? recurringOccurrences(rule, from, to) : []).find((period) => intervalsOverlap(period.from, period.to, from, to)) ?? null;
  return { available: !blockingUnavailability && !blockingRecurring, blockingUnavailability, blockingRecurring };
}
export function replacementIntervalWarnings(member: Candidate, from: Date, to: Date) {
  const availability = getReplacementAvailability(member, from, to), warnings: string[] = [];
  if (availability.blockingUnavailability) warnings.push("Nahlášená nedostupnost");
  if (availability.blockingRecurring) warnings.push("Pracovní směna 24/48 v tomto intervalu");
  return warnings;
}
export function manualReplacementOverrideAllowed(member: Pick<Candidate, "system">) {
  return !member.system;
}
export function weightedPick(candidates: Candidate[], random = Math.random) {
  const weights = candidates.map(
    (candidate) =>
      Math.max(0.15, 1 / (1 + candidate.serviceCount * 0.18)) *
      (candidate.lastService
        ? Math.min(
            3,
            Math.max(
              0.5,
              (Date.now() - candidate.lastService.getTime()) / 604800000,
            ),
          )
        : 3),
  );
  let cursor = random() * weights.reduce((left, right) => left + right, 0);
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return candidates[index];
  }
  return candidates.at(-1)!;
}
export function validateCrew(assignments: Assignment[], minimumDt = 1) {
  const errors: string[] = [],
    ids = assignments.map((assignment) => assignment.member.id);
  if (assignments.length !== 4) errors.push("Posádka musí mít přesně 4 členy.");
  if (new Set(ids).size !== ids.length)
    errors.push("Stejná osoba nesmí být použita dvakrát.");
  if (
    assignments.filter((assignment) => assignment.role === "COMMANDER")
      .length !== 1
  )
    errors.push("Chybí právě jeden velitel.");
  if (
    assignments.filter((assignment) => assignment.role === "DRIVER").length !==
    1
  )
    errors.push("Chybí právě jeden strojník.");
  if (
    assignments.filter((assignment) => assignment.role === "FIREFIGHTER")
      .length !== 2
  )
    errors.push("Posádka musí mít dva hasiče.");
  if (
    assignments.filter((assignment) => assignment.member.dt).length < minimumDt
  )
    errors.push(MISSING_DT_ERROR);
  return { valid: errors.length === 0, errors };
}
export function validateServiceForConfirmation(
  assignments: Assignment[],
  start: Date,
  end: Date,
  minimumDt = 1,
) {
  const eligibilityErrors = assignments.flatMap(
      (assignment) =>
        eligibility(
          assignment.member,
          assignment.role,
          start,
          end,
          assignment.mode === "MANUAL",
        ).reasons,
    ),
    crew = validateCrew(assignments, minimumDt),
    errors = [...new Set([...eligibilityErrors, ...crew.errors])];
  return { valid: errors.length === 0, errors };
}
export function validateBaseCrewForCoverage(assignments:Assignment[],start:Date,end:Date,minimumDt=1){const eligibilityErrors=assignments.flatMap(assignment=>eligibility(assignment.member,assignment.role,start,end,assignment.mode==='MANUAL').reasons),crew=validateCrew(assignments,minimumDt),errors=[...new Set([...eligibilityErrors,...crew.errors])];return{valid:errors.length===0,errors};}
export const shouldCreateMonthDraft = (
  status: "DRAFT" | "CONFIRMED" | "CANCELLED" | null,
) => status === null;
export function manualSelectionModes(
  current: {
    role: Role;
    slot: number;
    memberId: string;
    mode: "AUTO" | "MANUAL";
  }[],
  proposed: { role: Role; slot: number; memberId: string }[],
) {
  return proposed.map((item) => {
    const previous = current.find(
      (saved) => saved.role === item.role && saved.slot === item.slot,
    );
    return {
      ...item,
      mode:
        previous?.memberId === item.memberId
          ? (previous.mode ?? "AUTO")
          : ("MANUAL" as const),
    };
  });
}
export function assembleCrew(
  candidates: Candidate[],
  start: Date,
  end: Date,
  random = Math.random,
  minimumDt = 1,
  fairness: FairnessSettings = DEFAULT_FAIRNESS_SETTINGS,
): Assignment[] | null {
  const roles: Role[] = ["COMMANDER", "DRIVER", "FIREFIGHTER", "FIREFIGHTER"];
  let result: Assignment[] | null = null;
  const search = (index: number, used: Set<string>, picked: Assignment[]) => {
    if (index === roles.length) {
      if (validateCrew(picked, minimumDt).valid) result = [...picked];
      return;
    }
    const role = roles[index],
      pool = candidates.filter(
        (candidate) =>
          !used.has(candidate.id) &&
          eligibility(candidate, role, start, end).eligible,
      ),
      ordered = [...pool]
        .map((candidate) => ({
          candidate,
          tie: fairness.fairDraw ? random() : 0,
        }))
        .sort(
          (left, right) =>
            Number(
              !fairness.allowConsecutive && left.candidate.servedPreviousWeek,
            ) -
              Number(
                !fairness.allowConsecutive &&
                  right.candidate.servedPreviousWeek,
              ) ||
            (fairness.considerRole
              ? (left.candidate.roleServiceCount?.[role] ?? 0) -
                (right.candidate.roleServiceCount?.[role] ?? 0)
              : 0) ||
            (fairness.considerTotal
              ? left.candidate.serviceCount - right.candidate.serviceCount
              : 0) ||
            (fairness.preferRested
              ? (left.candidate.lastService?.getTime() ?? 0) -
                (right.candidate.lastService?.getTime() ?? 0)
              : 0) ||
            left.tie - right.tie,
        )
        .map((item) => item.candidate);
    for (const member of ordered) {
      used.add(member.id);
      picked.push({ role, member, mode: "AUTO" });
      search(index + 1, used, picked);
      if (result) return;
      picked.pop();
      used.delete(member.id);
    }
  };
  search(0, new Set(), []);
  return result;
}
export function replacementCandidates(
  assignments: Assignment[],
  replacedIndex: number,
  candidates: Candidate[],
  start: Date,
  end: Date,
  minimumDt = 1,
) {
  const replaced = assignments[replacedIndex];
  if (!replaced) return [];
  const remaining = assignments.filter((_, index) => index !== replacedIndex);
  const used = new Set(remaining.map((assignment) => assignment.member.id));
  used.add(replaced.member.id);
  return candidates
    .filter(
      (candidate) =>
        !used.has(candidate.id) &&
        eligibility(candidate, replaced.role, start, end).eligible,
    )
    .filter(
      (candidate) =>
        validateCrew(
          [
            ...remaining,
            { role: replaced.role, member: candidate, mode: "AUTO" },
          ],
          minimumDt,
        ).valid,
    );
}
export function suggestReplacement(
  assignments: Assignment[],
  replacedIndex: number,
  candidates: Candidate[],
  start: Date,
  end: Date,
  minimumDt = 1,
  random = Math.random,
) {
  const valid = replacementCandidates(
    assignments,
    replacedIndex,
    candidates,
    start,
    end,
    minimumDt,
  );
  if (valid.length)
    return { candidate: weightedPick(valid, random), error: null };
  const replaced = assignments[replacedIndex],
    remaining = assignments.filter((_, index) => index !== replacedIndex),
    used = new Set(remaining.map((assignment) => assignment.member.id));
  if (replaced) used.add(replaced.member.id);
  const otherwiseEligible = replaced
    ? candidates.filter(
        (candidate) =>
          !used.has(candidate.id) &&
          eligibility(candidate, replaced.role, start, end).eligible,
      )
    : [];
  const dtShortage = otherwiseEligible.some((candidate) =>
    validateCrew(
      [...remaining, { role: replaced.role, member: candidate, mode: "AUTO" }],
      minimumDt,
    ).errors.includes(MISSING_DT_ERROR),
  );
  return {
    candidate: null,
    error: dtShortage
      ? MISSING_DT_ERROR
      : "Pro tento časový interval nelze sestavit platnou posádku.",
  };
}

export function recurringOccurrences(
  rule: RecurringRule,
  rangeStart: Date,
  rangeEnd: Date,
) {
  if (rule.durationMinutes <= 0 || rule.intervalMinutes <= 0) return [];
  const duration = rule.durationMinutes * 60000,
    interval = rule.intervalMinutes * 60000,
    anchor = rule.anchorStart.getTime();
  let index = Math.max(
      0,
      Math.floor((rangeStart.getTime() - anchor) / interval) - 1,
    ),
    start = anchor + index * interval;
  const result: { from: Date; to: Date }[] = [];
  while (start < rangeEnd.getTime()) {
    const end = start + duration;
    if (end > rangeStart.getTime() && start < rangeEnd.getTime())
      result.push({
        from: new Date(Math.max(start, rangeStart.getTime())),
        to: new Date(Math.min(end, rangeEnd.getTime())),
      });
    index += 1;
    start = anchor + index * interval;
  }
  return result;
}

export type ReplacementPlanItem = {
  assignmentId: string;
  originalMemberId: string;
  replacementMemberId: string | null;
  role: Role;
  from: Date;
  to: Date;
  valid: boolean;
  issue: string | null;
};
export function planTemporaryReplacements(
  baseAssignments: (Assignment & { assignmentId: string })[],
  rulesByMember: Map<string, RecurringRule[]>,
  candidates: Candidate[],
  start: Date,
  end: Date,
  minimumDt = 1,
  random = Math.random,
) {
  const baseIds = new Set(baseAssignments.map((item) => item.member.id)),
    planned: ReplacementPlanItem[] = [];
  const candidateWorks = (
    candidate: Candidate,
    assignment: Assignment & { assignmentId: string },
    from: Date,
    to: Date,
  ) => {
    if (
      baseIds.has(candidate.id) ||
      !eligibility(candidate, assignment.role, from, to).eligible
    )
      return false;
    if (
      candidate.recurringUnavailable?.some(
        (rule) => recurringOccurrences(rule, from, to).length,
      )
    )
      return false;
    if (
      planned.some(
        (item) =>
          item.replacementMemberId === candidate.id &&
          intervalsOverlap(item.from, item.to, from, to),
      )
    )
      return false;
    const resulting = baseAssignments.map((item) =>
      item.assignmentId === assignment.assignmentId
        ? { ...item, member: candidate }
        : item,
    );
    return validateCrew(resulting, minimumDt).valid;
  };
  for (const assignment of baseAssignments) {
    const occurrences = [
      ...new Map(
        (rulesByMember.get(assignment.member.id) ?? [])
          .flatMap((rule) => recurringOccurrences(rule, start, end))
          .map((item) => [
            `${item.from.toISOString()}-${item.to.toISOString()}`,
            item,
          ]),
      ).values(),
    ].sort((a, b) => a.from.getTime() - b.from.getTime());
    if (!occurrences.length) continue;
    const common = candidates.filter((candidate) =>
      occurrences.every((interval) =>
        candidateWorks(candidate, assignment, interval.from, interval.to),
      ),
    );
    const preferred = common.length ? weightedPick(common, random) : null;
    for (const interval of occurrences) {
      const selected =
        preferred &&
        candidateWorks(preferred, assignment, interval.from, interval.to)
          ? preferred
          : (replacementCandidates(
              baseAssignments,
              baseAssignments.indexOf(assignment),
              candidates.filter(
                (candidate) =>
                  !baseIds.has(candidate.id) &&
                  !candidate.recurringUnavailable?.some(
                    (rule) =>
                      recurringOccurrences(rule, interval.from, interval.to)
                        .length,
                  ) &&
                  !planned.some(
                    (item) =>
                      item.replacementMemberId === candidate.id &&
                      intervalsOverlap(
                        item.from,
                        item.to,
                        interval.from,
                        interval.to,
                      ),
                  ),
              ),
              interval.from,
              interval.to,
              minimumDt,
            )[0] ?? null);
      planned.push({
        assignmentId: assignment.assignmentId,
        originalMemberId: assignment.member.id,
        replacementMemberId: selected?.id ?? null,
        role: assignment.role,
        from: interval.from,
        to: interval.to,
        valid: !!selected,
        issue: selected ? null : "Nenalezen vhodný náhradník.",
      });
    }
  }
  return planned;
}

export type CoverageDiagnostic = {
  from: Date;
  to: Date;
  missingRole: Role;
  availableCandidates: number;
  absentAssignments: {
    assignmentId: string;
    memberId: string;
    role: Role;
    slot: number;
  }[];
};
export function unresolvedRecurringReplacements(
  diagnostic: CoverageDiagnostic | null,
): ReplacementPlanItem[] {
  return diagnostic?.absentAssignments.map((absent) => ({
    assignmentId: absent.assignmentId,
    originalMemberId: absent.memberId,
    replacementMemberId: null,
    role: absent.role,
    from: diagnostic.from,
    to: diagnostic.to,
    valid: false,
    issue: "Nenalezen vhodný náhradník.",
  })) ?? [];
}
export type CoveredWeekPlan = {
  crew: (Assignment & { assignmentId: string })[];
  replacements: ReplacementPlanItem[];
  fairnessLevel: 1 | 2 | 3;
};

function orderedCandidates(
  candidates: Candidate[],
  role: Role,
  fairness: FairnessSettings,
  random: () => number,
) {
  return [...candidates]
    .map((candidate) => ({ candidate, tie: fairness.fairDraw ? random() : 0 }))
    .sort(
      (left, right) =>
        Number(left.candidate.servedPreviousWeek) -
          Number(right.candidate.servedPreviousWeek) ||
        (fairness.considerRole
          ? (left.candidate.roleServiceCount?.[role] ?? 0) -
            (right.candidate.roleServiceCount?.[role] ?? 0)
          : 0) ||
        (fairness.considerTotal
          ? left.candidate.serviceCount - right.candidate.serviceCount
          : 0) ||
        (fairness.preferRested
          ? (left.candidate.lastService?.getTime() ?? 0) -
            (right.candidate.lastService?.getTime() ?? 0)
          : 0) ||
        left.tie - right.tie,
    )
    .map((item) => item.candidate);
}
function candidateUnavailable(member: Candidate, from: Date, to: Date) {
  return (
    !!member.unavailable?.some((item) =>
      intervalsOverlap(item.from, item.to, from, to),
    ) ||
    !!member.recurringUnavailable?.some(
      (rule) => recurringOccurrences(rule, from, to).length,
    )
  );
}
function memberRecurringOutages(member: Candidate, start: Date, end: Date) {
  return (member.recurringUnavailable ?? []).flatMap((rule) =>
    recurringOccurrences(rule, start, end),
  );
}

export type TemporaryCrewPlan = {
  from: Date;
  to: Date;
  assignments: {
    assignmentId: string;
    role: Role;
    slot: number;
    member: Candidate;
    originalRole: Role | null;
  }[];
  absentMemberIds: string[];
};

/** Finds the best complete, valid crew for each recurring-work-shift interval. */
export function planTemporaryCrews(
  baseAssignments: (Assignment & { assignmentId: string; slot?: number })[],
  candidates: Candidate[],
  start: Date,
  end: Date,
  minimumDt = 1,
  random = Math.random,
): { plans: TemporaryCrewPlan[]; diagnostic: CoverageDiagnostic | null } {
  const outages = new Map(baseAssignments.map((item) => [
    item.assignmentId,
    memberRecurringOutages(item.member, start, end),
  ]));
  const points = [...new Set([
    start.getTime(), end.getTime(),
    ...[...outages.values()].flatMap((periods) => periods.flatMap((period) => [
      Math.max(start.getTime(), period.from.getTime()),
      Math.min(end.getTime(), period.to.getTime()),
    ])),
  ])].filter((value) => value >= start.getTime() && value <= end.getTime()).sort((a, b) => a - b);
  const baseIds = new Set(baseAssignments.map((item) => item.member.id));
  const baseByMember = new Map(baseAssignments.map((item) => [item.member.id, item]));
  const plans: TemporaryCrewPlan[] = [];
  let firstDiagnostic: CoverageDiagnostic | null = null;

  for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
    const from = new Date(points[segmentIndex]), to = new Date(points[segmentIndex + 1]);
    if (from >= to) continue;
    const absent = baseAssignments.filter((item) => outages.get(item.assignmentId)?.some((period) => intervalsOverlap(period.from, period.to, from, to)));
    if (!absent.length) continue;
    const absentIds = new Set(absent.map((item) => item.member.id));
    const positions = baseAssignments.map((item, index) => ({ ...item, slot: item.slot ?? (item.role === "FIREFIGHTER" ? baseAssignments.slice(0, index + 1).filter((value) => value.role === "FIREFIGHTER").length : 1) }));
    let best: { crew: Candidate[]; score: number[] } | null = null;
    const selected: Candidate[] = [];
    const compare = (left: number[], right: number[]) => {
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return left[index] > right[index];
      }
      return false;
    };
    const search = (index: number) => {
      if (index === positions.length) {
        const crew = positions.map((position, positionIndex) => ({ role: position.role, member: selected[positionIndex], mode: "AUTO" as const }));
        if (!validateCrew(crew, minimumDt).valid) return;
        const kept = selected.filter((member) => baseIds.has(member.id)).length;
        const unchanged = selected.filter((member, positionIndex) => member.id === positions[positionIndex].member.id).length;
        const internalHighRoleMoves = selected.filter((member, positionIndex) => {
          const original = baseByMember.get(member.id);
          return !!original && original.role !== positions[positionIndex].role && (positions[positionIndex].role === "COMMANDER" || positions[positionIndex].role === "DRIVER");
        }).length;
        const fairness = -selected.filter((member) => !baseIds.has(member.id)).reduce((sum, member) => sum + member.serviceCount + (member.roleServiceCount?.[positions[selected.indexOf(member)].role] ?? 0), 0);
        const score = [kept, internalHighRoleMoves, unchanged, fairness, random()];
        if (!best || compare(score, best.score)) best = { crew: [...selected], score };
        return;
      }
      const position = positions[index];
      for (const member of candidates) {
        if (selected.some((item) => item.id === member.id) || absentIds.has(member.id)) continue;
        if (!eligibility(member, position.role, from, to).eligible || candidateUnavailable(member, from, to)) continue;
        selected.push(member); search(index + 1); selected.pop();
      }
    };
    search(0);
    if (!best) {
      firstDiagnostic ??= {
        from,
        to,
        missingRole: absent[0].role,
        availableCandidates: 0,
        absentAssignments: positions
          .filter((position) => absent.some((item) => item.assignmentId === position.assignmentId))
          .map((position) => ({
            assignmentId: position.assignmentId,
            memberId: position.member.id,
            role: position.role,
            slot: position.slot,
          })),
      };
      continue;
    }
    const bestCrew = (best as { crew: Candidate[]; score: number[] }).crew;
    plans.push({
      from, to, absentMemberIds: [...absentIds],
      assignments: positions.map((position, index) => ({
        assignmentId: position.assignmentId,
        role: position.role,
        slot: position.slot,
        member: bestCrew[index],
        originalRole: baseByMember.get(bestCrew[index].id)?.role ?? null,
      })),
    });
  }
  return { plans, diagnostic: firstDiagnostic };
}

export function planCoveredSegments(
  baseAssignments: (Assignment & { assignmentId: string })[],
  candidates: Candidate[],
  start: Date,
  end: Date,
  minimumDt = 1,
  random = Math.random,
): {
  replacements: ReplacementPlanItem[];
  diagnostic: CoverageDiagnostic | null;
} {
  const result = planTemporaryCrews(baseAssignments, candidates, start, end, minimumDt, random);
  return {
    diagnostic: result.diagnostic,
    replacements: result.plans.flatMap((plan) => plan.assignments.flatMap((item) => {
      const original = baseAssignments.find((assignment) => assignment.assignmentId === item.assignmentId)!;
      return item.member.id === original.member.id ? [] : [{ assignmentId: item.assignmentId, originalMemberId: original.member.id, replacementMemberId: item.member.id, role: item.role, from: plan.from, to: plan.to, valid: true, issue: null }];
    })),
  };
}

export function solveCoveredWeek(
  candidates: Candidate[],
  start: Date,
  end: Date,
  minimumDt = 1,
  fairness: FairnessSettings = DEFAULT_FAIRNESS_SETTINGS,
  random = Math.random,
): { plan: CoveredWeekPlan | null; diagnostic: CoverageDiagnostic | null } {
  const roles: Role[] = ["COMMANDER", "DRIVER", "FIREFIGHTER", "FIREFIGHTER"],
    picked: (Assignment & { assignmentId: string })[] = [],
    used = new Set<string>();
  let solution: CoveredWeekPlan | null = null,
    fallback: CoveredWeekPlan | null = null,
    lastDiagnostic: CoverageDiagnostic | null = null;
  const search = (index: number) => {
    if (solution) return;
    if (index === roles.length) {
      if (!validateCrew(picked, minimumDt).valid) return;
      const coverage = planCoveredSegments(
        picked,
        candidates,
        start,
        end,
        minimumDt,
        random,
      );
      if (coverage.diagnostic) {
        lastDiagnostic = coverage.diagnostic;
        const repeated = picked.filter((item) => item.member.servedPreviousWeek).length;
        fallback ??= {
          crew: [...picked],
          replacements: [],
          fairnessLevel: repeated === 0 ? 1 : repeated < 4 ? 2 : 3,
        };
        return;
      }
      const repeated = picked.filter(
          (item) => item.member.servedPreviousWeek,
        ).length,
        level: 1 | 2 | 3 = repeated === 0 ? 1 : repeated < 4 ? 2 : 3;
      solution = {
        crew: [...picked],
        replacements: coverage.replacements,
        fairnessLevel: level,
      };
      return;
    }
    const role = roles[index],
      pool = orderedCandidates(
        candidates.filter(
          (candidate) =>
            !used.has(candidate.id) &&
            eligibility(candidate, role, start, end).eligible,
        ),
        role,
        fairness,
        random,
      ).sort((left, right) =>
        memberRecurringOutages(left, start, end).length - memberRecurringOutages(right, start, end).length,
      );
    for (const member of pool) {
      used.add(member.id);
      picked.push({
        role,
        member,
        mode: "AUTO",
        assignmentId: `${role}-${index}`,
      });
      search(index + 1);
      picked.pop();
      used.delete(member.id);
      if (solution) return;
    }
  };
  search(0);
  return { plan: solution ?? fallback, diagnostic: solution ? null : lastDiagnostic };
}
export function replacementStatistics(
  items: Pick<
    ReplacementPlanItem,
    "replacementMemberId" | "from" | "to" | "valid"
  >[],
) {
  const result = new Map<string, { count: number; hours: number }>();
  for (const item of items) {
    if (!item.valid || !item.replacementMemberId) continue;
    const current = result.get(item.replacementMemberId) ?? {
      count: 0,
      hours: 0,
    };
    current.count += 1;
    current.hours += (item.to.getTime() - item.from.getTime()) / 3600000;
    result.set(item.replacementMemberId, current);
  }
  return result;
}

export type PlanningHistory = { memberId: string; role: Role; weekStart: Date };
export function planWeeksSequentially(
  intervals: { start: Date; end: Date }[],
  baseCandidates: Candidate[],
  history: PlanningHistory[],
  settings: ServiceTimeSettings & FairnessSettings,
  random = Math.random,
) {
  const planned: {
    start: Date;
    end: Date;
    crew: (Assignment & { assignmentId: string })[];
    replacements: ReplacementPlanItem[];
  }[] = [];
  for (const interval of intervals) {
    const candidates = baseCandidates.map((candidate) => {
        const records = history.filter(
          (item) =>
            item.memberId === candidate.id && item.weekStart < interval.start,
        );
        return {
          ...candidate,
          serviceCount: records.length,
          roleServiceCount: {
            COMMANDER: records.filter((item) => item.role === "COMMANDER")
              .length,
            DRIVER: records.filter((item) => item.role === "DRIVER").length,
            FIREFIGHTER: records.filter((item) => item.role === "FIREFIGHTER")
              .length,
          },
          lastService: records.length
            ? new Date(
                Math.max(...records.map((item) => item.weekStart.getTime())),
              )
            : null,
          servedPreviousWeek: records.some((item) => {
            const difference =
              interval.start.getTime() - item.weekStart.getTime();
            return difference >= 6.5 * 86400000 && difference <= 7.5 * 86400000;
          }),
        };
      }),
      solved = solveCoveredWeek(
        candidates,
        interval.start,
        interval.end,
        settings.minimumDt,
        settings,
        random,
      );
    if (!solved.plan)
      return { planned, failed: interval, diagnostic: solved.diagnostic };
    planned.push({
      start: interval.start,
      end: interval.end,
      crew: solved.plan.crew,
      replacements: solved.plan.replacements,
    });
    history.push(
      ...solved.plan.crew.map((assignment) => ({
        memberId: assignment.member.id,
        role: assignment.role,
        weekStart: interval.start,
      })),
    );
  }
  return { planned, failed: null, diagnostic: null };
}
