import { conditioningAttention } from "@/lib/conditioning";
import { loadIntegrationConditioningData } from "@/lib/integration-data-server";
import {
  integrationMemberName,
  integrationResponse,
  requireIntegrationApi,
} from "@/lib/integration-api";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pragueToday(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
}

export async function GET(request: Request) {
  const unauthorized = requireIntegrationApi(request);
  if (unauthorized) return unauthorized;
  const now = new Date();
  const prisma = getPrisma();
  const [conditioning, members, services] = await Promise.all([
    loadIntegrationConditioningData(),
    prisma.member.findMany({
      where: { active: true, systemAccount: false },
      select: { id: true, firstName: true, lastName: true, medicalValidUntil: true },
    }),
    prisma.weeklyService.findMany({
      where: { status: { in: ["DRAFT", "CONFIRMED"] }, weekEnd: { gt: now } },
      include: {
        replacements: {
          where: { OR: [{ valid: false }, { replacementMemberId: null }] },
          include: { originalMember: true },
        },
      },
      orderBy: { weekStart: "asc" },
    }),
  ]);
  const attention = conditioningAttention(conditioning, now);
  const dt = attention.dt.map(({ member, duty }) => ({
    memberId: member.id,
    name: member.name,
    status: duty!.status === "expired" ? "overdue" : duty!.status,
    due: duty!.due,
    days: duty!.days,
  }));
  const drivers = attention.drivers.map(({ member }) => ({
    memberId: member.id,
    name: member.name,
    status: "missing",
    month: attention.monthLabel,
  }));
  const today = pragueToday(now);
  const medical = members.flatMap((member) => {
    if (!member.medicalValidUntil) return [];
    const due = new Date(Date.UTC(
      member.medicalValidUntil.getUTCFullYear(),
      member.medicalValidUntil.getUTCMonth(),
      member.medicalValidUntil.getUTCDate(),
      12,
    ));
    const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    if (days > 60) return [];
    return [{
      memberId: member.id,
      name: integrationMemberName(member),
      status: days < 0 ? "expired" : "expiring",
      due: due.toISOString().slice(0, 10),
      days,
    }];
  });
  const serviceItems = services.flatMap((service) => [
    ...(service.needsCrewChange
      ? [{
          serviceId: service.id,
          from: service.weekStart.toISOString(),
          to: service.weekEnd.toISOString(),
          status: "needsCrewChange",
          issue: service.crewIssue,
        }]
      : []),
    ...service.replacements.map((replacement) => ({
      serviceId: service.id,
      replacementId: replacement.id,
      memberId: replacement.originalMemberId,
      name: integrationMemberName(replacement.originalMember),
      from: replacement.from.toISOString(),
      to: replacement.to.toISOString(),
      status: "unresolvedReplacement",
      issue: replacement.issue,
    })),
  ]);
  return integrationResponse({
    totals: {
      dt: dt.length,
      drivers: drivers.length,
      medical: medical.length,
      services: serviceItems.length,
      all: dt.length + drivers.length + medical.length + serviceItems.length,
    },
    items: { dt, drivers, medical, services: serviceItems },
  }, now);
}
