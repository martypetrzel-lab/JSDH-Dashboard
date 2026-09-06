import { getPrisma } from "@/lib/prisma";
import {
  integrationResponse,
  integrationServiceInclude,
  requireIntegrationApi,
  serializeIntegrationService,
} from "@/lib/integration-api";
import { DEFAULT_SERVICE_SETTINGS } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireIntegrationApi(request);
  if (unauthorized) return unauthorized;
  const now = new Date();
  const prisma = getPrisma();
  const [service, settings] = await Promise.all([
    prisma.weeklyService.findFirst({
      where: { status: "CONFIRMED", weekStart: { gt: now } },
      include: integrationServiceInclude,
      orderBy: { weekStart: "asc" },
    }),
    prisma.settings.findUnique({ where: { id: "default" }, select: { minimumDt: true } }),
  ]);
  return integrationResponse(
    { service: service ? {
      ...serializeIntegrationService(service),
      dtCount: service.assignments.filter((member) => member.dtSnapshot).length,
      minimumDt: settings?.minimumDt ?? DEFAULT_SERVICE_SETTINGS.minimumDt,
    } : null },
    now,
  );
}
