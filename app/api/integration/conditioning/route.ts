import {
  driverDuty,
  dtDuty,
  latestDriverActivity,
  pragueMonth,
} from "@/lib/conditioning";
import { loadIntegrationConditioningData } from "@/lib/integration-data-server";
import { integrationResponse, requireIntegrationApi } from "@/lib/integration-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireIntegrationApi(request);
  if (unauthorized) return unauthorized;
  const now = new Date();
  const data = await loadIntegrationConditioningData();
  const currentMonth = pragueMonth(now);
  const month = `${currentMonth.year}-${String(currentMonth.month).padStart(2, "0")}`;
  const dt = data.members.filter((member) => member.dt).map((member) => {
    const duty = dtDuty(member, data.dtActivities, now, data.warningDays)!;
    return {
      memberId: member.id,
      name: member.name,
      lastActivity: duty.last?.date ?? null,
      lastActivityType: duty.last?.type ?? null,
      nextDue: duty.due,
      days: duty.days,
      status: duty.status === "expired" ? "overdue" : duty.status,
    };
  });
  const drivers = data.members.filter((member) => member.canDrive).map((member) => {
    const duty = driverDuty(member, data.driverActivities, now)!;
    const last = latestDriverActivity(member.id, data.driverActivities);
    return {
      memberId: member.id,
      name: member.name,
      month,
      fulfilled: duty.fulfilled,
      lastActivity: last?.date ?? null,
      lastActivityType: last?.type ?? null,
      vehicle: last?.vehicle ?? null,
      kilometers: last?.kilometers ?? null,
    };
  });
  return integrationResponse({ dt, drivers }, now);
}
