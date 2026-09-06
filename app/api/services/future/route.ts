import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  DEFAULT_FAIRNESS_SETTINGS,
  DEFAULT_SERVICE_SETTINGS,
  formatServiceDateTime,
  planWeeksSequentially,
  serviceDeletionAuditDescription,
  serviceMonthKey,
  serviceWeek,
  serviceWeeksForMonth,
  type Candidate,
  type Role,
} from "@/lib/service";
import { serializeWeeklyService } from "@/lib/weekly-service-data";
import { syncServiceReplacements } from "@/lib/service-replacements-server";

export const runtime = "nodejs";
const schema = z.object({
  action: z.enum(["DELETE_FROM", "REGENERATE_FROM", "REGENERATE_MONTH"]),
  from: z.iso.datetime(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  confirmedAcknowledged: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  if (!(await requireAdminApi()))
    return NextResponse.json(
      { error: "Nepřihlášený přístup." },
      { status: 401 },
    );
  try {
    const input = schema.parse(await request.json()),
      from = new Date(input.from),
      prisma = getPrisma();
    const [settings, members, allServices, allHistory] = await Promise.all([
      prisma.settings.findUnique({ where: { id: "default" } }),
      prisma.member.findMany({
        include: {
          unavailability: true,
          recurringUnavailability: { where: { active: true } },
        },
      }),
      prisma.weeklyService.findMany({
        where: {
          weekStart: { gte: from },
          status: { in: ["DRAFT", "CONFIRMED"] },
        },
        include: {
          assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] },
          replacements: { select: { id: true } },
        },
        orderBy: { weekStart: "asc" },
      }),
      prisma.weeklyServiceAssignment.findMany({
        where: { service: { status: { in: ["DRAFT", "CONFIRMED"] } } },
        select: {
          memberId: true,
          role: true,
          service: { select: { weekStart: true } },
        },
      }),
    ]);
    const rules = settings
      ? {
          weekStartDay: settings.weekStartDay,
          weekStartHour: settings.weekStartHour,
          weekEndDay: settings.weekEndDay,
          weekEndHour: settings.weekEndHour,
          minimumDt: settings.minimumDt,
          timezone: settings.timezone,
        }
      : DEFAULT_SERVICE_SETTINGS;
    const fairness = settings
      ? {
          fairDraw: settings.fairDraw,
          considerTotal: settings.considerTotal,
          considerRole: settings.considerRole,
          preferRested: settings.preferRested,
          allowConsecutive: settings.allowConsecutive,
        }
      : DEFAULT_FAIRNESS_SETTINGS;
    if (from < serviceWeek(new Date(), rules).start)
      return NextResponse.json(
        { error: "Minulé služby nelze hromadně odstranit ani přegenerovat." },
        { status: 409 },
      );
    const month = input.month ?? serviceMonthKey(from, rules.timezone),
      monthStarts = new Set(
        serviceWeeksForMonth(month, rules).map((item) => item.start.getTime()),
      );
    const targets =
      input.action === "REGENERATE_MONTH"
        ? allServices.filter((item) =>
            monthStarts.has(item.weekStart.getTime()),
          )
        : allServices;
    if (
      targets.some((item) => item.status === "CONFIRMED") &&
      !input.confirmedAcknowledged
    )
      return NextResponse.json(
        {
          error: "Součástí výběru jsou již potvrzené služby.",
          requiresConfirmedAcknowledgement: true,
        },
        { status: 409 },
      );
    const auditRows = targets.map((service) => ({
      action: "SERVICE_DELETED",
      entity: "WeeklyService",
      entityId: service.id,
      description: serviceDeletionAuditDescription({
        from: service.weekStart,
        to: service.weekEnd,
        status: service.status,
        crew: service.assignments.map((item) => ({
          role: item.role,
          name: item.nameSnapshot,
        })),
        replacementCount: service.replacements.length,
      }),
      actor: "Administrátor",
    }));
    if (input.action === "DELETE_FROM") {
      await prisma.$transaction(async (tx) => {
        if (auditRows.length) await tx.auditLog.createMany({ data: auditRows });
        await tx.weeklyService.deleteMany({
          where: { id: { in: targets.map((item) => item.id) } },
        });
      });
      return NextResponse.json({ deleted: targets.length, services: [] });
    }
    const intervals =
      input.action === "REGENERATE_MONTH"
        ? serviceWeeksForMonth(month, rules).filter(
            (item) => item.start >= from,
          )
        : targets.map((item) => ({ start: item.weekStart, end: item.weekEnd }));
    if (!intervals.length)
      return NextResponse.json(
        { error: "Od zvoleného týdne nejsou žádné služby k přegenerování." },
        { status: 404 },
      );
    const history = allHistory
      .filter((item) => item.service.weekStart < from)
      .map((item) => ({
        memberId: item.memberId,
        role: item.role as Role,
        weekStart: item.service.weekStart,
      }));
    const candidates: Candidate[] = members.map((member) => ({
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
      unavailable: member.unavailability.map((item) => ({
        from: item.from,
        to: item.to,
      })),
      recurringUnavailable: member.recurringUnavailability.map((item) => ({
        anchorStart: item.anchorStart,
        durationMinutes: item.durationMinutes,
        intervalMinutes: item.intervalMinutes,
      })),
    }));
    const planned = planWeeksSequentially(
      intervals,
      candidates,
      history,
      { ...rules, ...fairness },
      Math.random,
    );
    if (planned.failed) {
      const diagnostic = planned.diagnostic,
        role =
          diagnostic?.missingRole === "COMMANDER"
            ? "Velitel"
            : diagnostic?.missingRole === "DRIVER"
              ? "Strojník"
              : "Hasič";
      return NextResponse.json(
        {
          error: diagnostic
            ? `Týden nelze kompletně pokrýt. Kritický interval: ${formatServiceDateTime(diagnostic.from, rules.timezone)} → ${formatServiceDateTime(diagnostic.to, rules.timezone)}. Chybí: ${role}. Vhodných dostupných kandidátů: ${diagnostic.availableCandidates}.`
            : "Týden nelze kompletně pokrýt.",
        },
        { status: 422 },
      );
    }
    await prisma.$transaction(async (tx) => {
      if (auditRows.length) await tx.auditLog.createMany({ data: auditRows });
      await tx.weeklyService.deleteMany({
        where: { id: { in: targets.map((item) => item.id) } },
      });
      for (const item of planned.planned) {
        const service = await tx.weeklyService.create({
            data: { weekStart: item.start, weekEnd: item.end, status: "DRAFT" },
          }),
          slots = new Map<Role, number>(),
          assignmentIds = new Map<string, string>();
        for (const assignment of item.crew) {
          const slot = (slots.get(assignment.role) ?? 0) + 1;
          slots.set(assignment.role, slot);
          const saved = await tx.weeklyServiceAssignment.create({
            data: {
              serviceId: service.id,
              memberId: assignment.member.id,
              role: assignment.role,
              slot,
              selectionMode: "AUTO",
              nameSnapshot: assignment.member.name,
              roleSnapshot: assignment.role,
              dtSnapshot: assignment.member.dt,
            },
          });
          assignmentIds.set(assignment.assignmentId, saved.id);
        }
        if (item.replacements.length)
          await tx.serviceReplacement.createMany({
            data: item.replacements.map((replacement) => ({
              ...replacement,
              assignmentId: assignmentIds.get(replacement.assignmentId)!,
              serviceId: service.id,
              source: "RECURRING",
            })),
          });
      }
      await tx.auditLog.create({
        data: {
          action: "SERVICE_RANGE_REGENERATED",
          entity: "WeeklyService",
          entityId: input.from,
          description: `Služby od ${input.from} byly znovu vypočteny z aktuálních dat; počet týdnů: ${planned.planned.length}.`,
          actor: "Administrátor",
        },
      });
    });
    const regeneratedIds = await prisma.weeklyService.findMany({ where: { weekStart: { in: planned.planned.map((item) => item.start) } }, select: { id: true } });
    await Promise.all(regeneratedIds.map((item) => syncServiceReplacements(item.id)));
    const services = await prisma.weeklyService.findMany({
      where: { weekStart: { in: intervals.map((item) => item.start) } },
      include: {
        assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] },
        replacements: {
          include: { originalMember: true, replacementMember: true },
          orderBy: { from: "asc" },
        },
        temporaryAssignments: { include: { member: true }, orderBy: [{ from: "asc" }, { role: "asc" }, { slot: "asc" }] },
      },
      orderBy: { weekStart: "asc" },
    });
    return NextResponse.json({
      deleted: targets.length,
      regenerated: services.length,
      services: services.map(serializeWeeklyService),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Budoucí služby se nepodařilo změnit.",
      },
      { status: 400 },
    );
  }
}
