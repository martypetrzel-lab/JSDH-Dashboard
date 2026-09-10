import { getPrisma } from "@/lib/prisma";
import {
  effectiveIntegrationCrew,
  integrationOptions,
  integrationResponse,
  integrationRoute,
  integrationServiceInclude,
  requireIntegrationApi,
  serializeIntegrationCrew,
  serializeIntegrationReplacements,
} from "@/lib/integration-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = integrationOptions;

async function get(request: Request) {
  const unauthorized = requireIntegrationApi(request);
  if (unauthorized) return unauthorized;
  const now = new Date();
  const prisma = getPrisma();
  const [settings, service] = await Promise.all([
    prisma.settings.findUnique({ where: { id: "default" }, select: { minimumDt: true } }),
    prisma.weeklyService.findFirst({
      where: { status: "CONFIRMED", weekStart: { lte: now }, weekEnd: { gt: now } },
      include: integrationServiceInclude,
      orderBy: { weekStart: "desc" },
    }),
  ]);
  if (!service)
    return integrationResponse(request, { service: null, currentCrew: [] }, now);

  const minimumDt = settings?.minimumDt ?? 1;
  const currentCrew = effectiveIntegrationCrew(service, now);
  const dtCount = currentCrew.filter((member) => member.dt).length;
  const activeReplacements = service.replacements.filter(
    (item) => item.from <= now && now < item.to,
  );
  const valid =
    !service.needsCrewChange &&
    currentCrew.length === 4 &&
    new Set(currentCrew.map((member) => member.memberId)).size === 4 &&
    dtCount >= minimumDt &&
    activeReplacements.every((item) => item.valid && item.replacementMemberId);
  return integrationResponse(
    request,
    {
      service: {
        id: service.id,
        status: service.status,
        from: service.weekStart.toISOString(),
        to: service.weekEnd.toISOString(),
        baseCrew: serializeIntegrationCrew(service.assignments),
        replacements: serializeIntegrationReplacements(service.replacements),
        needsCrewChange: service.needsCrewChange,
        crewIssue: service.crewIssue,
      },
      currentCrew,
      activeReplacements: serializeIntegrationReplacements(activeReplacements),
      dtCount,
      minimumDt,
      valid,
    },
    now,
  );
}

export const GET = integrationRoute(get);
