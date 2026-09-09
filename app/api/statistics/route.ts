import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { fromLocalDateTimeInput, type Role } from "@/lib/service";
import { memberServiceStatistics, statisticsSummary } from "@/lib/statistics";

export const runtime = "nodejs";
const query = z.object({ year: z.coerce.number().int().min(2000).max(2200), month: z.coerce.number().int().min(0).max(12).default(0) });
const serializeDetail = (items: { serviceId: string; from: Date; to: Date; role: Role }[]) => items.map((item) => ({ ...item, from: item.from.toISOString(), to: item.to.toISOString() }));

export async function GET(request: Request) {
  if (!(await requireAdminApi())) return NextResponse.json({ error: "Nepřihlášený přístup." }, { status: 401 });
  try {
    const input = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const startMonth = input.month || 1, endYear = input.month === 12 ? input.year + 1 : input.year, endMonth = input.month === 12 ? 1 : input.month ? input.month + 1 : 1;
    const from = fromLocalDateTimeInput(`${input.year}-${String(startMonth).padStart(2, "0")}-01T00:00`, "Europe/Prague")!;
    const to = fromLocalDateTimeInput(`${input.month ? endYear : input.year + 1}-${String(endMonth).padStart(2, "0")}-01T00:00`, "Europe/Prague")!;
    const prisma = getPrisma();
    const [members, assignments, replacements] = await Promise.all([
      prisma.member.findMany({ where: { systemAccount: false }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
      prisma.weeklyServiceAssignment.findMany({ where: { service: { weekStart: { gte: from, lt: to }, status: { not: "CANCELLED" } } }, include: { service: true } }),
      prisma.serviceReplacement.findMany({ where: { valid: true, replacementMemberId: { not: null }, service: { weekStart: { gte: from, lt: to }, status: { not: "CANCELLED" } } }, include: { service: true } }),
    ]);
    const now = new Date();
    const rows = memberServiceStatistics(
      members.map((member) => ({ id: member.id, name: `${member.firstName} ${member.lastName === "—" ? "" : member.lastName}`.trim(), active: member.active, dt: member.dt })),
      assignments.map((item) => ({ memberId: item.memberId, role: item.role as Role, service: item.service })),
      replacements.map((item) => ({ replacementMemberId: item.replacementMemberId, role: item.role as Role, from: item.from, to: item.to, valid: item.valid, service: item.service })),
      now,
    );
    return NextResponse.json({
      rows: rows.map((row) => ({ ...row, lastServedAt: row.lastServedAt?.toISOString() ?? null, nextPlannedAt: row.nextPlannedAt?.toISOString() ?? null, servedDetail: serializeDetail(row.servedDetail), plannedDetail: serializeDetail(row.plannedDetail), replacementDetail: serializeDetail(row.replacementDetail) })),
      summary: statisticsSummary(rows, assignments.map((item) => ({ memberId: item.memberId, role: item.role as Role, service: item.service })), now),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Statistiky se nepodařilo načíst." }, { status: 400 });
  }
}
