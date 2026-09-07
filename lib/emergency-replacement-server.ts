import { getPrisma } from "./prisma";
import { DEFAULT_SERVICE_SETTINGS, eligibility, getReplacementAvailability, intervalsOverlap, manualReplacementOverrideAllowed, replacementCandidates, weightedPick, type Assignment, type Candidate, type ReplacementBlockingInterval, type Role } from "./service";
import { toPlanningCandidates } from "./service-candidates";

export async function prepareEmergencyReplacement(
  serviceId: string,
  assignmentId: string,
  from: Date,
  to: Date,
  ignoreReplacementId?: string,
  requestedMemberId?: string | null,
  forceManualOverride = false,
) {
  const prisma = getPrisma();
  const [service, settings, members, history] = await Promise.all([
    prisma.weeklyService.findUnique({ where: { id: serviceId }, include: { assignments: true, replacements: true, temporaryAssignments: true } }),
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.member.findMany({ include: { unavailability: true, recurringUnavailability: { where: { active: true } } } }),
    prisma.weeklyServiceAssignment.findMany({ where: { service: { status: { in: ["CONFIRMED", "DRAFT"] } } }, select: { memberId: true, role: true, service: { select: { weekStart: true } } } }),
  ]);
  if (!service) throw new Error("Služba nebyla nalezena.");
  if (service.status === "CANCELLED") throw new Error("Zrušenou službu nelze upravit.");
  if (from >= to || from < service.weekStart || to > service.weekEnd) throw new Error("Interval záskoku musí ležet uvnitř týdenní služby.");
  const assignment = service.assignments.find((item) => item.id === assignmentId);
  if (!assignment) throw new Error("Pozice služby nebyla nalezena.");
  if (service.replacements.some((item) => item.id !== ignoreReplacementId && item.assignmentId === assignmentId && intervalsOverlap(item.from, item.to, from, to))) throw new Error("Pro tuto pozici už v zadaném čase existuje jiný záskok.");

  const candidates = toPlanningCandidates(members, history, service.weekStart).map((candidate) => ({
    ...candidate,
    recurringUnavailable: members.find((member) => member.id === candidate.id)?.recurringUnavailability.map((rule) => ({ anchorStart: rule.anchorStart, durationMinutes: rule.durationMinutes, intervalMinutes: rule.intervalMinutes })) ?? [],
  }));
  const assignments: Assignment[] = service.assignments.map((item) => ({ role: item.role as Role, member: candidates.find((candidate) => candidate.id === item.memberId)!, mode: item.selectionMode }));
  const index = service.assignments.findIndex((item) => item.id === assignmentId);
  const busyIds = new Set(service.replacements.filter((item) => item.id !== ignoreReplacementId && item.replacementMemberId && intervalsOverlap(item.from, item.to, from, to)).map((item) => item.replacementMemberId!));
  for(const item of service.temporaryAssignments)if(intervalsOverlap(item.from,item.to,from,to))busyIds.add(item.memberId);
  const availabilityById = new Map(candidates.map((candidate) => [candidate.id, getReplacementAvailability(candidate, from, to)]));
  const nonRecurring = candidates.filter((candidate) => !busyIds.has(candidate.id) && availabilityById.get(candidate.id)!.available).map((candidate) => ({ ...candidate, unavailable: [], recurringUnavailable: [] }));
  const valid = replacementCandidates(assignments, index, nonRecurring, from, to, settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt);
  const validIds = new Set(valid.map((candidate) => candidate.id));
  const baseIds = new Set(service.assignments.map((item) => item.memberId));
  const options = candidates.filter(manualReplacementOverrideAllowed).map((candidate) => {
    const reasons: string[] = [];
    const blockingIntervals: ReplacementBlockingInterval[] = [];
    if (candidate.id === assignment.memberId) reasons.push("Původní vypadlý člen nemůže zastupovat sám sebe.");
    else if (baseIds.has(candidate.id)) reasons.push("Člen už je v tomto čase v základní posádce.");
    const check = eligibility({ ...candidate, unavailable: [] }, assignment.role as Role, from, to);
    reasons.push(...check.reasons);
    const availability = availabilityById.get(candidate.id)!;
    if (availability.blockingUnavailability) { reasons.push("Nahlášená nedostupnost"); blockingIntervals.push({ type: "UNAVAILABILITY", ...availability.blockingUnavailability }); }
    if (availability.blockingRecurring) { reasons.push("Pracovní směna 24/48 v tomto intervalu"); blockingIntervals.push({ type: "RECURRING", ...availability.blockingRecurring }); }
    if (busyIds.has(candidate.id)) reasons.push("V tomto čase už zastupuje jinou pozici.");
    if (!reasons.length && !validIds.has(candidate.id)) reasons.push(`Po této změně by sestava nesplnila minimum ${settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt} DT.`);
    return { id: candidate.id, name: candidate.name, dt: candidate.dt, eligible: reasons.length === 0, warnings: [...new Set(reasons)], reason: reasons[0] ?? null, blockingIntervals: blockingIntervals.map((period) => ({ type: period.type, from: period.from.toISOString(), to: period.to.toISOString() })) };
  }).sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.name.localeCompare(right.name, "cs"));

  let selected: Candidate | null;
  if (requestedMemberId) {
    const requested = candidates.find((candidate) => candidate.id === requestedMemberId);
    if (!requested) throw new Error("Vybraný náhradník nebyl nalezen.");
    if (!manualReplacementOverrideAllowed(requested)) throw new Error("Systémový účet nelze použít jako náhradníka.");
    const option = options.find((item) => item.id === requestedMemberId)!;
    if (!forceManualOverride && !option.eligible) {
      const roleLabel = assignment.role === "COMMANDER" ? "Velitel" : assignment.role === "DRIVER" ? "Strojník" : "Hasič";
      if (option.warnings.includes("chybí oprávnění")) throw new Error(`${requested.name} nemá oprávnění ${roleLabel}.`);
      if (option.warnings.includes("Nahlášená nedostupnost")) throw new Error(`${requested.name} je v tomto intervalu nedostupný.`);
      if (option.warnings.includes("V tomto čase už zastupuje jinou pozici.")) throw new Error(`${requested.name} už v tomto čase zastupuje jinou pozici.`);
      if (option.warnings.some((warning) => warning.includes("minimum") && warning.includes("DT"))) throw new Error("Po této změně by sestava nesplnila minimum DT.");
      throw new Error(`${requested.name}: ${option.reason}`);
    }
    selected = requested;
  } else selected = valid.length ? weightedPick(valid) : null;
  const roleName = assignment.role === "COMMANDER" ? "velitel" : assignment.role === "DRIVER" ? "strojník" : "hasič";
  const selectedWarnings = requestedMemberId ? options.find((item) => item.id === requestedMemberId)?.warnings ?? [] : [];
  return { service, assignment, selected, issue: selected ? null : `Chybí náhradní ${roleName}.`, candidates: options, selectedWarnings };
}
