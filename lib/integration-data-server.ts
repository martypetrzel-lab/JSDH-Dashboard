import { getPrisma } from "@/lib/prisma";
import { serializeDriverActivity, serializeDtActivity } from "@/lib/conditioning-data";
import type { ConditioningData } from "@/lib/conditioning";
import { integrationMemberName } from "@/lib/integration-api";

export async function loadIntegrationConditioningData(): Promise<ConditioningData> {
  const prisma = getPrisma();
  const [members, settings] = await Promise.all([
    prisma.member.findMany({
      where: { active: true, systemAccount: false },
      include: {
        dtActivities: { orderBy: { date: "desc" } },
        driverActivities: { orderBy: { date: "desc" } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.settings.findUnique({
      where: { id: "default" },
      select: { conditioningWarningDays: true },
    }),
  ]);
  return {
    members: members.map((member) => ({
      id: member.id,
      name: integrationMemberName(member),
      dt: member.dt,
      canDrive: member.canDrive,
    })),
    dtActivities: members.flatMap((member) => member.dtActivities.map(serializeDtActivity)),
    driverActivities: members.flatMap((member) => member.driverActivities.map(serializeDriverActivity)),
    warningDays: settings?.conditioningWarningDays ?? 30,
  };
}
