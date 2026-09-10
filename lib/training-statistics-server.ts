import { getPrisma } from './prisma';
import {
  buildTrainingStatistics,
  defaultStatisticsPeriod,
  statisticsPeriod,
  trainingStatisticsQuerySchema,
} from './training-statistics';

export function parseTrainingStatisticsRequest(request: Request) {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (!query.from && !query.to) {
    const period = defaultStatisticsPeriod();
    return { period, activeOnly: query.activeOnly !== 'false' };
  }
  const input = trainingStatisticsQuerySchema.parse(query);
  return {
    period: statisticsPeriod(input.from, input.to),
    activeOnly: input.activeOnly,
  };
}

export async function loadTrainingStatistics(
  request: Request,
  memberId?: string,
) {
  const { period, activeOnly } = parseTrainingStatisticsRequest(request);
  const prisma = getPrisma();
  const memberWhere = {
    systemAccount: false,
    ...(activeOnly ? { active: true } : {}),
    ...(memberId ? { id: memberId } : {}),
  };
  const [members, sessions] = await Promise.all([
    prisma.member.findMany({
      where: memberWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        active: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    prisma.trainingSession.findMany({
      where: {
        status: 'COMPLETED',
        date: { gte: period.fromDate, lt: period.toExclusive },
        ...(memberId ? { participants: { some: { memberId } } } : {}),
      },
      select: {
        id: true,
        date: true,
        durationMinutes: true,
        status: true,
        topics: {
          select: {
            topicId: true,
            nameSnapshot: true,
            categorySnapshot: true,
            subcategorySnapshot: true,
          },
        },
        participants: {
          select: { memberId: true, status: true },
        },
      },
      orderBy: { date: 'desc' },
    }),
  ]);
  if (memberId && !members.length)
    throw Object.assign(new Error('Člen nebyl nalezen.'), { code: 'P2025' });
  return buildTrainingStatistics(members, sessions, period, activeOnly);
}
