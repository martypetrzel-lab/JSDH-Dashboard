import { z } from 'zod';
import type { TrainingSessionRow } from './training';

const dateValue = z.iso.date();
export const trainingStatisticsQuerySchema = z
  .object({
    from: dateValue,
    to: dateValue,
    activeOnly: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value !== 'false'),
  })
  .refine(
    (value) => value.from <= value.to,
    'Datum Od musí být před datem Do.',
  );

export type StatisticsPeriod = {
  from: string;
  to: string;
  fromDate: Date;
  toExclusive: Date;
};

export function statisticsPeriod(from: string, to: string): StatisticsPeriod {
  dateValue.parse(from);
  dateValue.parse(to);
  if (from > to) throw new Error('Datum Od musí být před datem Do.');
  const toExclusive = new Date(`${to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return {
    from,
    to,
    fromDate: new Date(`${from}T00:00:00.000Z`),
    toExclusive,
  };
}

export function defaultStatisticsPeriod(now = new Date()) {
  const year = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
  }).format(now);
  return statisticsPeriod(`${year}-01-01`, `${year}-12-31`);
}

export type StatisticsPreset =
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'THIS_YEAR'
  | 'LAST_YEAR';

export function statisticsPresetPeriod(
  preset: StatisticsPreset,
  now = new Date(),
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  const currentYear = value('year');
  const currentMonth = value('month');
  if (preset === 'THIS_YEAR')
    return statisticsPeriod(`${currentYear}-01-01`, `${currentYear}-12-31`);
  if (preset === 'LAST_YEAR')
    return statisticsPeriod(
      `${currentYear - 1}-01-01`,
      `${currentYear - 1}-12-31`,
    );
  const monthDate = new Date(
    Date.UTC(currentYear, currentMonth - (preset === 'LAST_MONTH' ? 2 : 1), 1),
  );
  const year = monthDate.getUTCFullYear();
  const month = monthDate.getUTCMonth() + 1;
  const pad = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return statisticsPeriod(
    `${year}-${pad}-01`,
    `${year}-${pad}-${String(lastDay).padStart(2, '0')}`,
  );
}

export function attendancePercent(present: number, total: number) {
  return total ? Math.round((present / total) * 100) : null;
}

export function formatTrainingMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

type StatisticsMemberSource = {
  id: string;
  firstName: string;
  lastName: string;
  active: boolean;
  systemAccount?: boolean;
};
type StatisticsSessionSource = {
  id: string;
  date: Date | string;
  durationMinutes: number;
  status?: 'DRAFT' | 'COMPLETED';
  topics: {
    topicId: string;
    nameSnapshot: string;
    categorySnapshot: string;
    subcategorySnapshot: string;
  }[];
  participants: {
    memberId: string;
    status: 'PRESENT' | 'ABSENT' | 'EXCUSED';
  }[];
};

export type TrainingStatisticsMember = {
  id: string;
  name: string;
  active: boolean;
  present: number;
  absent: number;
  excused: number;
  recordedSessions: number;
  durationMinutes: number;
  attendancePercent: number | null;
  lastAttendance: string | null;
  sessions: {
    id: string;
    date: string;
    durationMinutes: number;
    status: 'PRESENT' | 'ABSENT' | 'EXCUSED';
    topics: TrainingSessionRow['topics'];
  }[];
};

export type TrainingStatistics = {
  period: { from: string; to: string };
  summary: {
    sessions: number;
    durationMinutes: number;
    present: number;
    absent: number;
    excused: number;
    attendanceRecords: number;
    attendancePercent: number | null;
  };
  members: TrainingStatisticsMember[];
};

const isoDay = (value: Date | string) =>
  (value instanceof Date ? value.toISOString() : value).slice(0, 10);

export function buildTrainingStatistics(
  members: StatisticsMemberSource[],
  sessions: StatisticsSessionSource[],
  period: Pick<StatisticsPeriod, 'from' | 'to'>,
  activeOnly = false,
): TrainingStatistics {
  const completedSessions = sessions.filter(
    (session) =>
      (!session.status || session.status === 'COMPLETED') &&
      isoDay(session.date) >= period.from &&
      isoDay(session.date) <= period.to,
  );
  const rows = members
    .filter((member) => !member.systemAccount && (!activeOnly || member.active))
    .map<TrainingStatisticsMember>((member) => {
      const records = completedSessions
        .flatMap((session) => {
          const participant = session.participants.find(
            (item) => item.memberId === member.id,
          );
          return participant
            ? [
                {
                  id: session.id,
                  date: isoDay(session.date),
                  durationMinutes: session.durationMinutes,
                  status: participant.status,
                  topics: session.topics,
                },
              ]
            : [];
        })
        .sort((a, b) => b.date.localeCompare(a.date));
      const present = records.filter((record) => record.status === 'PRESENT');
      const absent = records.filter(
        (record) => record.status === 'ABSENT',
      ).length;
      const excused = records.filter(
        (record) => record.status === 'EXCUSED',
      ).length;
      return {
        id: member.id,
        name: [member.firstName, member.lastName === '—' ? '' : member.lastName]
          .filter(Boolean)
          .join(' '),
        active: member.active,
        present: present.length,
        absent,
        excused,
        recordedSessions: records.length,
        durationMinutes: present.reduce(
          (total, record) => total + record.durationMinutes,
          0,
        ),
        attendancePercent: attendancePercent(present.length, records.length),
        lastAttendance: present[0]?.date ?? null,
        sessions: records,
      };
    });
  const present = rows.reduce((total, row) => total + row.present, 0);
  const absent = rows.reduce((total, row) => total + row.absent, 0);
  const excused = rows.reduce((total, row) => total + row.excused, 0);
  const attendanceRecords = present + absent + excused;
  return {
    period: { from: period.from, to: period.to },
    summary: {
      sessions: completedSessions.length,
      durationMinutes: completedSessions.reduce(
        (total, session) => total + session.durationMinutes,
        0,
      ),
      present,
      absent,
      excused,
      attendanceRecords,
      attendancePercent: attendancePercent(present, attendanceRecords),
    },
    members: rows.sort((a, b) => a.name.localeCompare(b.name, 'cs')),
  };
}
