import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { baseCrewEligibility, DEFAULT_SERVICE_SETTINGS, fullyUnavailable, planningServiceWeek, recurringOccurrences, validateCrew, type Candidate, type Role } from "@/lib/service";
import { formatCzechDate } from "@/lib/member-data";
import { serializeWeeklyService } from "@/lib/weekly-service-data";
import { syncServiceReplacements } from "@/lib/service-replacements-server";

const postSchema = z.object({
  reference: z.iso.datetime(),
  assignments: z.array(z.object({ role: z.enum(["COMMANDER", "DRIVER", "FIREFIGHTER"]), slot: z.number().int().min(1).max(2), memberId: z.string().min(1) })).length(4),
});

type ManualMember = { id:string; firstName:string; lastName:string; active:boolean; systemAccount:boolean; reserveOnly:boolean; dt:boolean; medicalExamAt:Date|null; medicalValidUntil:Date|null; canCommand:boolean; canDrive:boolean; canFight:boolean; unavailability:{from:Date;to:Date}[] };
const toCandidate = (member: ManualMember): Candidate => ({
  id: member.id, name: `${member.firstName} ${member.lastName === "—" ? "" : member.lastName}`.trim(), active: member.active, system: member.systemAccount, reserveOnly: member.reserveOnly, dt: member.dt,
  medicalExam: member.medicalExamAt, medicalValidUntil: member.medicalValidUntil,
  roles: [member.canCommand && "COMMANDER", member.canDrive && "DRIVER", member.canFight && "FIREFIGHTER"].filter(Boolean) as Role[],
  serviceCount: 0, lastService: null, unavailable: member.unavailability,
});

async function context(reference: Date) {
  const prisma = getPrisma();
  const [settings, members] = await Promise.all([
    prisma.settings.findUnique({ where: { id: "default" } }),
    prisma.member.findMany({ include: { unavailability: true, recurringUnavailability: { where: { active: true } } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
  ]);
  const rules = settings ? { weekStartDay: settings.weekStartDay, weekStartHour: settings.weekStartHour, weekEndDay: settings.weekEndDay, weekEndHour: settings.weekEndHour, minimumDt: settings.minimumDt, timezone: settings.timezone } : DEFAULT_SERVICE_SETTINGS;
  return { prisma, settings, members, rules, interval: planningServiceWeek(reference, rules) };
}

export async function GET(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "Nepřihlášený přístup." }, { status: 401 });
  try {
    const value = new URL(request.url).searchParams.get("reference"), reference = value ? new Date(value) : new Date();
    if (Number.isNaN(reference.getTime())) throw new Error("Neplatný týden.");
    const { members, rules, interval } = await context(reference);
    return NextResponse.json({
      interval: { from: interval.start.toISOString(), to: interval.end.toISOString() }, minimumDt: rules.minimumDt,
      candidates: members.map((member) => {
        const candidate = toCandidate(member), hardUnavailable = fullyUnavailable(candidate, interval.start, interval.end);
        const recurringCount = member.recurringUnavailability.flatMap((rule) => recurringOccurrences(rule, interval.start, interval.end)).length;
        const partialUnavailable = !hardUnavailable && member.unavailability.some((item) => item.from < interval.end && interval.start < item.to);
        return { id: member.id, name: candidate.name, roles: candidate.roles, dt: member.dt, medicalValidUntil: formatCzechDate(member.medicalValidUntil), available: candidate.roles.length > 0 && baseCrewEligibility(candidate, candidate.roles[0], interval.start, interval.end).reasons.filter((reason) => reason !== "chybí oprávnění").length === 0, hardUnavailable, recurringCount, warnings: [hardUnavailable && "Nedostupný po celý týden", partialUnavailable && "Částečná nedostupnost bude řešena záskokem", recurringCount > 0 && `Pracovní směna 24/48: ${recurringCount} intervalů se záskokem`, !member.medicalValidUntil && "Chybí platná zdravotní prohlídka"].filter(Boolean) };
      }),
    });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Editor se nepodařilo načíst." }, { status: 400 }); }
}

export async function POST(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "Nepřihlášený přístup." }, { status: 401 });
  try {
    const input = postSchema.parse(await request.json()), { prisma, members, rules, interval } = await context(new Date(input.reference));
    const existing = await prisma.weeklyService.findUnique({ where: { weekStart: interval.start } });
    if (existing) return NextResponse.json({ error: "Pro tento týden již služba existuje. Použijte Upravit sestavu." }, { status: 409 });
    const expected = ["COMMANDER:1", "DRIVER:1", "FIREFIGHTER:1", "FIREFIGHTER:2"];
    if (!expected.every((key) => input.assignments.some((item) => `${item.role}:${item.slot}` === key))) throw new Error("Vyberte velitele, strojníka a dva hasiče.");
    if (new Set(input.assignments.map((item) => item.memberId)).size !== 4) throw new Error("Stejný člen nesmí být vybrán dvakrát.");
    const crew = input.assignments.map((item) => {
      const member = members.find((candidate) => candidate.id === item.memberId);
      if (!member) throw new Error("Vybraný člen nebyl nalezen.");
      const candidate = toCandidate(member), check = baseCrewEligibility(candidate, item.role, interval.start, interval.end);
      if (!check.eligible) throw new Error(`${candidate.name}: ${check.reasons.join(", ")}.`);
      return { ...item, member: candidate, mode: "MANUAL" as const };
    });
    const validation = validateCrew(crew, rules.minimumDt);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
    const serviceId = await prisma.$transaction(async (tx) => {
      const service = await tx.weeklyService.create({ data: { weekStart: interval.start, weekEnd: interval.end, status: "DRAFT" } });
      await tx.weeklyServiceAssignment.createMany({ data: crew.map((item) => ({ serviceId: service.id, memberId: item.member.id, role: item.role, slot: item.slot, selectionMode: "MANUAL", nameSnapshot: item.member.name, roleSnapshot: item.role, dtSnapshot: item.member.dt })) });
      await tx.auditLog.create({ data: { action: "WEEK_DRAFT_CREATED_MANUAL", entity: "WeeklyService", entityId: service.id, description: "Ruční návrh týdenní služby byl vytvořen.", actor: "Administrátor" } });
      return service.id;
    });
    await syncServiceReplacements(serviceId);
    const service = await prisma.weeklyService.findUniqueOrThrow({ where: { id: serviceId }, include: { assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] }, replacements: { include: { originalMember: true, replacementMember: true }, orderBy: { from: "asc" } }, temporaryAssignments: { include: { member: true }, orderBy: [{ from: "asc" }, { role: "asc" }, { slot: "asc" }] } } });
    return NextResponse.json({ service: serializeWeeklyService(service) }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Ruční návrh se nepodařilo uložit." }, { status: 400 }); }
}
