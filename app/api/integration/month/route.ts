import { getPrisma } from "@/lib/prisma";
import {
  integrationError,
  integrationResponse,
  integrationServiceInclude,
  requireIntegrationApi,
  serializeIntegrationService,
  validIntegrationMonth,
} from "@/lib/integration-api";
import { DEFAULT_SERVICE_SETTINGS, serviceWeeksForMonth } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireIntegrationApi(request);
  if (unauthorized) return unauthorized;
  const month = new URL(request.url).searchParams.get("month");
  if (!validIntegrationMonth(month))
    return integrationError("month must use YYYY-MM format");
  const selectedMonth = month!;

  const now = new Date();
  const prisma = getPrisma();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
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
  const intervals = serviceWeeksForMonth(selectedMonth, rules);
  const services = await prisma.weeklyService.findMany({
    where: { weekStart: { in: intervals.map((item) => item.start) } },
    include: integrationServiceInclude,
    orderBy: { weekStart: "asc" },
  });
  return integrationResponse(
    {
      month: selectedMonth,
      services: services.map((service) => ({
        ...serializeIntegrationService(service),
        minimumDt: rules.minimumDt,
      })),
    },
    now,
  );
}
