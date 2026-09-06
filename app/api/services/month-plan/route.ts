import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  DEFAULT_FAIRNESS_SETTINGS,
  DEFAULT_SERVICE_SETTINGS,
  formatServiceDateTime,
  serviceWeeksForMonth,
  shouldCreateMonthDraft,
  solveCoveredWeek,
  type Candidate,
  type Role,
} from "@/lib/service";
import { toPlanningCandidates } from "@/lib/service-candidates";
import { serializeWeeklyService } from "@/lib/weekly-service-data";

export const runtime = "nodejs";
const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

export async function POST(request: Request) {
  if (!(await requireAdminApi()))
    return NextResponse.json(
      { error: "Nepřihlášený přístup." },
      { status: 401 },
    );
  try {
    const { month } = schema.parse(await request.json()),
      prisma = getPrisma();
    const [settings, members, allHistory] = await Promise.all([
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
    const intervals = serviceWeeksForMonth(month, rules),
      existing = await prisma.weeklyService.findMany({
        where: { weekStart: { in: intervals.map((item) => item.start) } },
        include: { assignments: true },
      }),
      history = [...allHistory],
      createdIds: string[] = [],
      errors: { from: string; error: string }[] = [];
    for (const interval of intervals) {
      const saved = existing.find(
        (item) => item.weekStart.getTime() === interval.start.getTime(),
      );
      if (!shouldCreateMonthDraft(saved?.status ?? null)) continue;
      const candidates: Candidate[] = toPlanningCandidates(
        members,
        history,
        interval.start,
      ).map((candidate) => ({
        ...candidate,
        recurringUnavailable:
          members
            .find((member) => member.id === candidate.id)
            ?.recurringUnavailability.map((item) => ({
              anchorStart: item.anchorStart,
              durationMinutes: item.durationMinutes,
              intervalMinutes: item.intervalMinutes,
            })) ?? [],
      }));
      const solved = solveCoveredWeek(
        candidates,
        interval.start,
        interval.end,
        rules.minimumDt,
        fairness,
        Math.random,
      );
      if (!solved.plan) {
        const diagnostic = solved.diagnostic,
          role =
            diagnostic?.missingRole === "COMMANDER"
              ? "Velitel"
              : diagnostic?.missingRole === "DRIVER"
                ? "Strojník"
                : "Hasič";
        errors.push({
          from: interval.start.toISOString(),
          error: diagnostic
            ? `Týden nelze kompletně pokrýt. Kritický interval: ${formatServiceDateTime(diagnostic.from, rules.timezone)} → ${formatServiceDateTime(diagnostic.to, rules.timezone)}. Chybí: ${role}. Vhodných dostupných kandidátů: ${diagnostic.availableCandidates}.`
            : "Týden nelze kompletně pokrýt.",
        });
        continue;
      }
      const plan = solved.plan;
      const id = await prisma.$transaction(async (tx) => {
        const service = await tx.weeklyService.create({
            data: {
              weekStart: interval.start,
              weekEnd: interval.end,
              status: "DRAFT",
            },
          }),
          slots = new Map<Role, number>(),
          assignmentIds = new Map<string, string>();
        for (const assignment of plan.crew) {
          const slot = (slots.get(assignment.role) ?? 0) + 1;
          slots.set(assignment.role, slot);
          const record = await tx.weeklyServiceAssignment.create({
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
          assignmentIds.set(assignment.assignmentId, record.id);
        }
        if (plan.replacements.length)
          await tx.serviceReplacement.createMany({
            data: plan.replacements.map((item) => ({
              ...item,
              assignmentId: assignmentIds.get(item.assignmentId)!,
              serviceId: service.id,
              source: "RECURRING",
            })),
          });
        await tx.auditLog.create({
          data: {
            action: "WEEK_DRAFT_CREATED",
            entity: "WeeklyService",
            entityId: service.id,
            description: `Plně pokrytý návrh služby byl vytvořen v měsíčním plánu ${month}.`,
            actor: "Administrátor",
          },
        });
        return service.id;
      });
      createdIds.push(id);
      history.push(
        ...plan.crew.map((assignment) => ({
          memberId: assignment.member.id,
          role: assignment.role,
          service: { weekStart: interval.start },
        })),
      );
    }
    await prisma.auditLog.create({
      data: {
        action: "MONTH_PLAN_CREATED",
        entity: "MonthlyPlan",
        entityId: month,
        description: `Měsíční plán ${month} byl vytvořen; nové plně pokryté návrhy: ${createdIds.length}.`,
        actor: "Administrátor",
      },
    });
    const services = await prisma.weeklyService.findMany({
      where: { weekStart: { in: intervals.map((item) => item.start) } },
      include: {
        assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] },
        replacements: {
          include: { originalMember: true, replacementMember: true },
          orderBy: { from: "asc" },
        },
      },
      orderBy: { weekStart: "asc" },
    });
    return NextResponse.json({
      services: services.map(serializeWeeklyService),
      created: createdIds.length,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Měsíční plán se nepodařilo vytvořit.",
      },
      { status: 400 },
    );
  }
}
