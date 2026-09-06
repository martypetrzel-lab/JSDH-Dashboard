import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import {
  DEFAULT_FAIRNESS_SETTINGS,
  DEFAULT_SERVICE_SETTINGS,
  formatServiceDateTime,
  planningServiceWeek,
  solveCoveredWeek,
  type Candidate,
  type Role,
} from "@/lib/service";
import { serializeWeeklyService } from "@/lib/weekly-service-data";
import { syncServiceReplacements } from "@/lib/service-replacements-server";

export const runtime = "nodejs";
const inputSchema = z.object({ reference: z.iso.datetime().optional() });

export async function POST(request: Request) {
  if (!(await requireAdminApi()))
    return NextResponse.json(
      { error: "Nepřihlášený přístup." },
      { status: 401 },
    );
  try {
    const input = inputSchema.parse(await request.json());
    const prisma = getPrisma();
    const [settings, members, history] = await Promise.all([
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
    const interval = planningServiceWeek(
      input.reference ? new Date(input.reference) : new Date(),
      rules,
    );
    const relevantHistory = history.filter(
        (item) => item.service.weekStart < interval.start,
      ),
      previousStart = interval.start.getTime() - 7 * 86400000;
    const candidates: Candidate[] = members.map((member) => {
      const records = relevantHistory.filter(
        (item) => item.memberId === member.id,
      );
      return {
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
        serviceCount: records.length,
        roleServiceCount: {
          COMMANDER: records.filter((item) => item.role === "COMMANDER").length,
          DRIVER: records.filter((item) => item.role === "DRIVER").length,
          FIREFIGHTER: records.filter((item) => item.role === "FIREFIGHTER")
            .length,
        },
        lastService: records.length
          ? new Date(
              Math.max(
                ...records.map((item) => item.service.weekStart.getTime()),
              ),
            )
          : null,
        servedPreviousWeek: records.some(
          (item) => item.service.weekStart.getTime() === previousStart,
        ),
        unavailable: member.unavailability.map((item) => ({
          from: item.from,
          to: item.to,
        })),
        recurringUnavailable: member.recurringUnavailability.map((item) => ({
          anchorStart: item.anchorStart,
          durationMinutes: item.durationMinutes,
          intervalMinutes: item.intervalMinutes,
        })),
      };
    });
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
              : "Hasič",
        detail = diagnostic
          ? `\n\nKritický interval:\n${formatServiceDateTime(diagnostic.from, rules.timezone)} → ${formatServiceDateTime(diagnostic.to, rules.timezone)}\n\nChybí:\n${role}\n\nVhodných dostupných kandidátů: ${diagnostic.availableCandidates}`
          : "";
      return NextResponse.json(
        { error: `Týden nelze kompletně pokrýt.${detail}` },
        { status: 422 },
      );
    }
    const { crew, replacements } = solved.plan;
    const serviceId = await prisma.$transaction(async (tx) => {
      const existing = await tx.weeklyService.findUnique({
        where: { weekStart: interval.start },
      });
      if (existing?.status === "CANCELLED")
        throw new Error("Zrušenou službu nelze přelosovat.");
      const service = existing
        ? await tx.weeklyService.update({
            where: { id: existing.id },
            data: { weekEnd: interval.end, needsCrewChange: false, crewIssue: null },
          })
        : await tx.weeklyService.create({
            data: {
              weekStart: interval.start,
              weekEnd: interval.end,
              status: "DRAFT",
            },
          });
      await tx.serviceReplacement.deleteMany({
        where: { serviceId: service.id },
      });
      await tx.weeklyServiceAssignment.deleteMany({
        where: { serviceId: service.id },
      });
      const slots = new Map<Role, number>();
      const assignmentIds = new Map<string, string>();
      for (const assignment of crew) {
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
      if (replacements.length)
        await tx.serviceReplacement.createMany({
          data: replacements.map((item) => ({
            ...item,
            assignmentId: assignmentIds.get(item.assignmentId)!,
            serviceId: service.id,
            source: "RECURRING",
          })),
        });
      await tx.auditLog.create({
        data: {
          action: existing ? "SERVICE_REROLLED" : "WEEK_DRAFT_CREATED",
          entity: "WeeklyService",
          entityId: service.id,
          description: `Týdenní posádka byla automaticky ${existing ? "přelosována" : "vytvořena"}; stav: ${service.status}.${solved.diagnostic ? " 1 interval vyžaduje ruční záskok." : ""}`,
          actor: "Administrátor",
        },
      });
      return service.id;
    });
    await syncServiceReplacements(serviceId);
    const service = await prisma.weeklyService.findUniqueOrThrow({
      where: { id: serviceId },
      include: {
        assignments: { orderBy: [{ role: "asc" }, { slot: "asc" }] },
        replacements: {
          include: { originalMember: true, replacementMember: true },
          orderBy: { from: "asc" },
        },
        temporaryAssignments: { include: { member: true }, orderBy: [{ from: "asc" }, { role: "asc" }, { slot: "asc" }] },
      },
    });
    return NextResponse.json({ service: serializeWeeklyService(service) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Návrh posádky se nepodařilo vytvořit.",
      },
      { status: 400 },
    );
  }
}
