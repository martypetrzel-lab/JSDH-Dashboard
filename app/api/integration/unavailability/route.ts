import {
  integrationError,
  integrationMemberName,
  integrationResponse,
  parseIntegrationRangeValue,
  requireIntegrationApi,
} from "@/lib/integration-api";
import { getPrisma } from "@/lib/prisma";
import { recurringOccurrences } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireIntegrationApi(request);
  if (unauthorized) return unauthorized;
  const now = new Date();
  try {
    const params = new URL(request.url).searchParams;
    const from = parseIntegrationRangeValue(params.get("from"), now);
    const to = parseIntegrationRangeValue(
      params.get("to"),
      new Date(now.getTime() + 30 * 86400000),
    );
    if (from >= to) return integrationError("from must be before to");
    const prisma = getPrisma();
    const [unavailability, recurring] = await Promise.all([
      prisma.unavailability.findMany({
        where: { from: { lt: to }, to: { gt: from } },
        include: { member: true },
        orderBy: { from: "asc" },
      }),
      prisma.recurringUnavailability.findMany({
        where: { active: true, anchorStart: { lt: to } },
        include: { member: true },
        orderBy: { anchorStart: "asc" },
      }),
    ]);
    const workShifts = recurring.flatMap((rule) =>
      recurringOccurrences(
        {
          anchorStart: rule.anchorStart,
          durationMinutes: rule.durationMinutes,
          intervalMinutes: rule.intervalMinutes,
        },
        from,
        to,
      ).map((occurrence) => ({
        memberId: rule.memberId,
        name: integrationMemberName(rule.member),
        from: occurrence.from.toISOString(),
        to: occurrence.to.toISOString(),
        reason: rule.reason,
      })),
    ).sort((left, right) => left.from.localeCompare(right.from));
    return integrationResponse({
      from: from.toISOString(),
      to: to.toISOString(),
      unavailability: unavailability.map((item) => ({
        memberId: item.memberId,
        name: integrationMemberName(item.member),
        from: item.from.toISOString(),
        to: item.to.toISOString(),
        reason: item.reason,
      })),
      workShifts,
    }, now);
  } catch (error) {
    return integrationError(error instanceof Error ? error.message : "Invalid date range");
  }
}
