import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { eligibility, recurringOccurrences, validateCrew, type Candidate, type Role } from "@/lib/service";

const assignmentSchema = z.object({ role: z.enum(["COMMANDER", "DRIVER", "FIREFIGHTER"]), slot: z.number().int().min(1).max(2), memberId: z.string().min(1), originalAssignmentId: z.string().min(1).nullable().optional() });
const schema = z.object({ from: z.coerce.date(), to: z.coerce.date(), reason: z.string().trim().max(300).optional(), assignments: z.array(assignmentSchema).length(4) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "Nepřihlášený přístup." }, { status: 401 });
  try {
    const { id } = await context.params, input = schema.parse(await request.json()), prisma = getPrisma();
    const [service, settings, members] = await Promise.all([
      prisma.weeklyService.findUnique({ where: { id }, include: { assignments: true } }),
      prisma.settings.findUnique({ where: { id: "default" } }),
      prisma.member.findMany({ where: { id: { in: input.assignments.map((item) => item.memberId) } }, include: { unavailability: true, recurringUnavailability: { where: { active: true } } } }),
    ]);
    if (!service) return NextResponse.json({ error: "Služba nebyla nalezena." }, { status: 404 });
    if (input.from < service.weekStart || input.to > service.weekEnd || input.from >= input.to) throw new Error("Interval musí ležet uvnitř týdenní služby.");
    if (new Set(input.assignments.map((item) => item.memberId)).size !== 4) throw new Error("Jedna osoba nesmí mít dvě dočasné funkce.");
    const crew = input.assignments.map((item) => {
      const member = members.find((candidate) => candidate.id === item.memberId);
      if (!member) throw new Error("Vybraný člen nebyl nalezen.");
      const candidate: Candidate = { id: member.id, name: `${member.firstName} ${member.lastName}`.trim(), active: member.active, system: member.systemAccount, reserveOnly: member.reserveOnly, dt: member.dt, medicalExam: member.medicalExamAt, medicalValidUntil: member.medicalValidUntil, roles: [member.canCommand && "COMMANDER", member.canDrive && "DRIVER", member.canFight && "FIREFIGHTER"].filter(Boolean) as Role[], serviceCount: 0, lastService: null, unavailable: member.unavailability.map((period) => ({ from: period.from, to: period.to })) };
      if (!eligibility(candidate, item.role, input.from, input.to).eligible || member.recurringUnavailability.some((rule) => recurringOccurrences(rule, input.from, input.to).length)) throw new Error(`${candidate.name} není pro dočasnou funkci způsobilý nebo dostupný.`);
      return { role: item.role as Role, member: candidate, mode: "MANUAL" as const };
    });
    const validation = validateCrew(crew, settings?.minimumDt ?? 1);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
    const collision = await prisma.serviceTemporaryAssignment.findFirst({ where: { serviceId: id, NOT: { from: input.from, to: input.to }, from: { lt: input.to }, to: { gt: input.from } } });
    if (collision) throw new Error("Interval se překrývá s jinou dočasnou sestavou.");
    const existed = await prisma.serviceTemporaryAssignment.count({ where: { serviceId: id, from: input.from, to: input.to } });
    await prisma.$transaction(async (tx) => {
      await tx.serviceTemporaryAssignment.deleteMany({ where: { serviceId: id, from: input.from, to: input.to } });
      await tx.serviceTemporaryAssignment.createMany({ data: input.assignments.map((item) => ({ ...item, originalAssignmentId: item.originalAssignmentId ?? service.assignments.find((base) => base.role === item.role && base.slot === item.slot)?.id ?? null, serviceId: id, from: input.from, to: input.to, source: "MANUAL", reason: input.reason })) });
      await tx.auditLog.create({ data: { action: existed ? "TEMP_CREW_UPDATED" : "TEMP_CREW_CREATED", entity: "WeeklyService", entityId: id, description: `Dočasná sestava ${input.from.toISOString()}–${input.to.toISOString()}: ${crew.map((item) => `${item.member.name} – ${item.role}`).join(", ")}.`, actor: "Administrátor" } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Dočasnou sestavu se nepodařilo uložit." }, { status: 400 }); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "Nepřihlášený přístup." }, { status: 401 });
  try {
    const { id } = await context.params, url = new URL(request.url), from = new Date(url.searchParams.get("from") ?? ""), to = new Date(url.searchParams.get("to") ?? "");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("Chybí interval dočasné sestavy.");
    const prisma = getPrisma();
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.serviceTemporaryAssignment.deleteMany({ where: { serviceId: id, from, to } });
      await tx.auditLog.create({ data: { action: "TEMP_CREW_DELETED", entity: "WeeklyService", entityId: id, description: `Dočasná sestava ${from.toISOString()}–${to.toISOString()} byla odstraněna; pozic: ${deleted.count}.`, actor: "Administrátor" } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Dočasnou sestavu se nepodařilo odstranit." }, { status: 400 }); }
}
