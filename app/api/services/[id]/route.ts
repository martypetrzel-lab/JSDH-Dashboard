import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  canHardDeleteService,
  DEFAULT_SERVICE_SETTINGS,
  eligibility,
  intervalsOverlap,
  manualSelectionModes,
  planCoveredSegments,
  serviceDeletionAuditDescription,
  validateCrew,
  type Assignment,
  type Candidate,
  type Role,
} from "@/lib/service";
import { serializeWeeklyService } from "@/lib/weekly-service-data";
import { toPlanningCandidates } from "@/lib/service-candidates";

export const runtime = "nodejs";
const patchSchema = z.object({
  role: z.enum(["COMMANDER", "DRIVER", "FIREFIGHTER"]),
  slot: z.number().int().min(1).max(2),
  memberId: z.string().min(1),
  acknowledgeWarnings: z.boolean().default(false),
});
const putSchema = z.object({
  assignments: z
    .array(
      z.object({
        role: z.enum(["COMMANDER", "DRIVER", "FIREFIGHTER"]),
        slot: z.number().int().min(1).max(2),
        memberId: z.string().min(1),
      }),
    )
    .length(4),
});
const deleteSchema = z.object({
  confirmedAcknowledged: z.boolean().optional().default(false),
});
const candidate = (member: {
  id: string;
  firstName: string;
  lastName: string;
  active: boolean;
  systemAccount: boolean;
  reserveOnly: boolean;
  dt: boolean;
  medicalExamAt: Date | null;
  medicalValidUntil: Date | null;
  canCommand: boolean;
  canDrive: boolean;
  canFight: boolean;
  unavailability: { from: Date; to: Date }[];
}): Candidate => ({
  id: member.id,
  name: `${member.firstName} ${member.lastName === "—" ? "" : member.lastName}`.trim(),
  active: member.active,
  system: member.systemAccount,
  reserveOnly: member.reserveOnly,
  dt: member.dt,
  medicalExam: member.medicalExamAt,
  medicalValidUntil: member.medicalValidUntil,
  roles: [
    member.canCommand && "COMMANDER",
    member.canDrive && "DRIVER",
    member.canFight && "FIREFIGHTER",
  ].filter(Boolean) as Role[],
  serviceCount: 0,
  lastService: null,
  unavailable: member.unavailability,
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdminApi()))
    return NextResponse.json(
      { error: "Nepřihlášený přístup." },
      { status: 401 },
    );
  try {
    const { id } = await context.params,
      input = patchSchema.parse(await request.json()),
      prisma = getPrisma(),
      [service, settings, member] = await Promise.all([
        prisma.weeklyService.findUnique({
          where: { id },
          include: {
            assignments: {
              include: { member: { include: { unavailability: true } } },
            },
          },
        }),
        prisma.settings.findUnique({ where: { id: "default" } }),
        prisma.member.findUnique({
          where: { id: input.memberId },
          include: { unavailability: true },
        }),
      ]);
    if (!service || service.status === "CONFIRMED")
      return NextResponse.json(
        { error: "Upravovat lze pouze návrh služby." },
        { status: 409 },
      );
    if (!member)
      return NextResponse.json(
        { error: "Člen nebyl nalezen." },
        { status: 404 },
      );
    const selected = candidate(member),
      eligibilityResult = eligibility(
        selected,
        input.role,
        service.weekStart,
        service.weekEnd,
        true,
      ),
      warnings: string[] = [];
    if (member.reserveOnly) warnings.push("člen je veden pouze na počet");
    if (
      member.unavailability.some((item) =>
        intervalsOverlap(
          item.from,
          item.to,
          service.weekStart,
          service.weekEnd,
        ),
      )
    )
      warnings.push("člen je v tomto týdnu nedostupný");
    if (eligibilityResult.reasons.length)
      return NextResponse.json(
        { error: eligibilityResult.reasons.join("\n") },
        { status: 422 },
      );
    if (warnings.length && !input.acknowledgeWarnings)
      return NextResponse.json(
        { error: "Ruční změna vyžaduje potvrzení.", warnings },
        { status: 409 },
      );
    const assignments: Assignment[] = service.assignments.map((item) => ({
        role: item.role as Role,
        member:
          item.role === input.role && item.slot === input.slot
            ? selected
            : candidate(item.member),
        mode: "MANUAL",
      })),
      validation = validateCrew(
        assignments,
        settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt,
      );
    if (!validation.valid)
      return NextResponse.json(
        { error: validation.errors.join("\n") },
        { status: 422 },
      );
    await prisma.$transaction([
      prisma.weeklyServiceAssignment.update({
        where: {
          serviceId_role_slot: {
            serviceId: id,
            role: input.role,
            slot: input.slot,
          },
        },
        data: {
          memberId: member.id,
          selectionMode: "MANUAL",
          nameSnapshot: selected.name,
          roleSnapshot: input.role,
          dtSnapshot: selected.dt,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "MEMBER_CHANGED",
          entity: "WeeklyService",
          entityId: id,
          description: `Člen na pozici ${input.role} byl ručně změněn.`,
          actor: "Administrátor",
        },
      }),
    ]);
    const updated = await prisma.weeklyService.findUniqueOrThrow({
      where: { id },
      include: { assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] } },
    });
    return NextResponse.json({
      service: serializeWeeklyService(updated),
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Službu se nepodařilo upravit.",
      },
      { status: 400 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdminApi()))
    return NextResponse.json(
      { error: "Nepřihlášený přístup." },
      { status: 401 },
    );
  try {
    const { id } = await context.params,
      input = putSchema.parse(await request.json()),
      prisma = getPrisma(),
      [service, settings, members, history] = await Promise.all([
        prisma.weeklyService.findUnique({
          where: { id },
          include: { assignments: true },
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
    if (!service)
      return NextResponse.json(
        { error: "Služba nebyla nalezena." },
        { status: 404 },
      );
    if (service.status === "CANCELLED")
      return NextResponse.json(
        { error: "Zrušenou službu nelze upravit." },
        { status: 409 },
      );
    const positionKeys = input.assignments.map(
      (item) => `${item.role}-${item.slot}`,
    );
    if (
      new Set(positionKeys).size !== 4 ||
      input.assignments.some(
        (item) =>
          !service.assignments.some(
            (saved) => saved.role === item.role && saved.slot === item.slot,
          ),
      )
    )
      return NextResponse.json(
        { error: "Sestava neobsahuje právě všechny čtyři pozice." },
        { status: 422 },
      );
    const selectionModes = manualSelectionModes(
        service.assignments.map((saved) => ({
          role: saved.role as Role,
          slot: saved.slot,
          memberId: saved.memberId,
          mode: saved.selectionMode,
        })),
        input.assignments,
      ),
      candidates = toPlanningCandidates(
        members,
        history,
        service.weekStart,
      ).map((item) => ({
        ...item,
        recurringUnavailable:
          members
            .find((member) => member.id === item.id)
            ?.recurringUnavailability.map((rule) => ({
              anchorStart: rule.anchorStart,
              durationMinutes: rule.durationMinutes,
              intervalMinutes: rule.intervalMinutes,
            })) ?? [],
      })),
      proposed = input.assignments.map((item) => {
        const selected = candidates.find(
          (member) => member.id === item.memberId,
        );
        if (!selected) throw new Error("Vybraný člen nebyl nalezen.");
        return {
          ...item,
          assignmentId:
            service.assignments.find(
              (saved) => saved.role === item.role && saved.slot === item.slot,
            )?.id ?? "",
          member: selected,
          mode: selectionModes.find(
            (saved) => saved.role === item.role && saved.slot === item.slot,
          )!.mode,
        };
      }),
      crewValidation = validateCrew(
        proposed,
        settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt,
      ),
      eligibilityErrors = proposed.flatMap((item) => {
        const errors = eligibility(
          item.member,
          item.role,
          service.weekStart,
          service.weekEnd,
          true,
        ).reasons;
        return errors;
      });
    if (!crewValidation.valid || eligibilityErrors.length)
      return NextResponse.json(
        {
          error: [
            ...new Set([...crewValidation.errors, ...eligibilityErrors]),
          ].join("\n"),
        },
        { status: 422 },
      );
    const coverage = planCoveredSegments(
        proposed,
        candidates,
        service.weekStart,
        service.weekEnd,
        settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt,
      ),
      replacements = coverage.replacements;
    if (coverage.diagnostic)
      return NextResponse.json(
        {
          error: `Týden nelze kompletně pokrýt.\n${coverage.diagnostic.from.toISOString()} – ${coverage.diagnostic.to.toISOString()}`,
        },
        { status: 422 },
      );
    const changes = proposed
      .map((item) => {
        const old = service.assignments.find(
          (saved) => saved.id === item.assignmentId,
        )!;
        return { item, old };
      })
      .filter((entry) => entry.old.memberId !== entry.item.member.id);
    if (!changes.length)
      return NextResponse.json(
        { error: "Sestava neobsahuje žádnou změnu." },
        { status: 400 },
      );
    await prisma.$transaction(async (tx) => {
      await tx.serviceReplacement.deleteMany({
        where: { assignmentId: { in: changes.map((entry) => entry.old.id) } },
      });
      await tx.serviceReplacement.deleteMany({
        where: { serviceId: id, source: "RECURRING" },
      });
      for (const { item, old } of changes) {
        await tx.weeklyServiceAssignment.update({
          where: { id: old.id },
          data: {
            memberId: item.member.id,
            selectionMode: item.mode,
            nameSnapshot: item.member.name,
            roleSnapshot: item.role,
            dtSnapshot: item.member.dt,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "BASE_MEMBER_CHANGED",
            entity: "WeeklyService",
            entityId: id,
            description: `Role ${item.role}; původní člen: ${old.nameSnapshot}; nový člen: ${item.member.name}; stav služby: ${service.status}.`,
            actor: "Administrátor",
          },
        });
      }
      if (replacements.length)
        await tx.serviceReplacement.createMany({
          data: replacements.map((item) => ({
            ...item,
            serviceId: id,
            source: "RECURRING",
          })),
        });
    });
    const updated = await prisma.weeklyService.findUniqueOrThrow({
      where: { id },
      include: {
        assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] },
        replacements: {
          include: { originalMember: true, replacementMember: true },
          orderBy: { from: "asc" },
        },
      },
    });
    return NextResponse.json({
      service: serializeWeeklyService(updated),
      updatedConfirmed: service.status === "CONFIRMED",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Sestavu se nepodařilo uložit.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdminApi()))
    return NextResponse.json(
      { error: "Nepřihlášený přístup." },
      { status: 401 },
    );
  try {
    const { id } = await context.params;
    const input = deleteSchema.parse(await request.json().catch(() => ({})));
    const prisma = getPrisma();
    const service = await prisma.weeklyService.findUnique({
      where: { id },
      include: {
        assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] },
        replacements: { select: { id: true } },
      },
    });
    if (!service)
      return NextResponse.json(
        { error: "Služba nebyla nalezena." },
        { status: 404 },
      );
    if (!canHardDeleteService(service.status, input.confirmedAcknowledged))
      return NextResponse.json(
        {
          error:
            service.status === "CONFIRMED"
              ? "Potvrďte, že rozumíte smazání potvrzené služby."
              : "Tuto službu nelze úplně smazat.",
        },
        { status: 409 },
      );
    const description = serviceDeletionAuditDescription({
      from: service.weekStart,
      to: service.weekEnd,
      status: service.status,
      crew: service.assignments.map((item) => ({
        role: item.role,
        name: item.nameSnapshot,
      })),
      replacementCount: service.replacements.length,
    });
    await prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          action: "SERVICE_DELETED",
          entity: "WeeklyService",
          entityId: id,
          description,
          actor: "Administrátor",
        },
      });
      await tx.weeklyService.delete({ where: { id } });
    });
    return NextResponse.json({
      ok: true,
      interval: {
        from: service.weekStart.toISOString(),
        to: service.weekEnd.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Službu se nepodařilo smazat.",
      },
      { status: 400 },
    );
  }
}
