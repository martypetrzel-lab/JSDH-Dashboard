import { z } from 'zod';

export const trainingTypes = {
  THEORY: 'Teoretická',
  PRACTICE: 'Praktická',
  COMBINED: 'Kombinovaná',
};
export const attendanceLabels = {
  PRESENT: 'Přítomen',
  ABSENT: 'Nepřítomen',
  EXCUSED: 'Omluven',
};
export const trainingStatuses = { DRAFT: 'Návrh', COMPLETED: 'Dokončeno' };
const searchable = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ');
export function topicMatchesSearch(
  topic: { name: string; category: string; subcategory: string },
  query: string,
) {
  return searchable(
    `${topic.category} ${topic.subcategory} ${topic.name}`,
  ).includes(searchable(query.trim()));
}
export const primaryRoleLabels: Record<string, string> = {
  UNIT_COMMANDER: 'Velitel jednotky',
  SQUAD_COMMANDER: 'Velitel družstva',
  DRIVER: 'Strojník',
  FIREFIGHTER: 'Hasič',
  UNASSIGNED: 'Neurčeno',
};
const optionalText = z.string().trim().max(10000).nullable().optional();
export const topicSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(
      /^[a-z0-9-]+$/,
      'Kód smí obsahovat malá písmena bez diakritiky, číslice a pomlčky.',
    ),
  name: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(160),
  subcategory: z.string().trim().min(1).max(160),
  description: optionalText,
  source: optionalText,
  sourceUrl: z
    .union([
      z.literal(''),
      z
        .url()
        .refine((value) =>
          ['http:', 'https:'].includes(new URL(value).protocol),
        ),
    ])
    .nullable()
    .optional(),
  sourceType: z
    .enum(['HASICI_VZDELAVANI', 'INTERNAL', 'OTHER'])
    .default('INTERNAL'),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export const participantSchema = z.object({
  memberId: z.string().min(1),
  status: z.enum(['PRESENT', 'ABSENT', 'EXCUSED']),
  note: optionalText,
});
export const attendanceSchema = z
  .object({
    participants: z.array(participantSchema).max(1000),
    completedAcknowledged: z.boolean().default(false),
  })
  .refine(
    (value) =>
      new Set(value.participants.map((p) => p.memberId)).size ===
      value.participants.length,
    'Člen je uveden vícekrát.',
  );
export const sessionSchema = z
  .object({
    date: z.iso.date(),
    startTime: z.iso.datetime().nullable().optional(),
    endTime: z.iso.datetime().nullable().optional(),
    durationMinutes: z.number().int().positive().max(10080),
    location: optionalText,
    trainingType: z.enum(['THEORY', 'PRACTICE', 'COMBINED']),
    instructorName: z.string().trim().min(1).max(200),
    instructorMemberId: z.string().min(1).nullable().optional(),
    notes: optionalText,
    status: z.enum(['DRAFT', 'COMPLETED']),
    topicIds: z.array(z.string().min(1)).min(1).max(500),
    participants: z.array(participantSchema).max(1000),
    completedAcknowledged: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if (new Set(value.topicIds).size !== value.topicIds.length)
      issue('Téma je uvedeno vícekrát.');
    if (
      new Set(value.participants.map((p) => p.memberId)).size !==
      value.participants.length
    )
      issue('Člen je uveden vícekrát.');
    if (value.status === 'COMPLETED' && !value.participants.length)
      issue('Dokončené školení musí mít účastníky.');
    if (
      value.startTime &&
      value.endTime &&
      new Date(value.endTime) <= new Date(value.startTime)
    )
      issue('Čas do musí být po čase od.');
    for (const time of [value.startTime, value.endTime]) {
      if (time) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Prague',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(new Date(time));
        const part = (type: string) =>
          parts.find((p) => p.type === type)?.value;
        if ([part('year'), part('month'), part('day')].join('-') !== value.date)
          issue('Čas musí patřit k zadanému dni školení (Europe/Prague).');
      }
    }
  });
export const archiveSchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2200).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    category: z.string().max(160).optional(),
    topicId: z.string().optional(),
    instructor: z.string().max(200).optional(),
    trainingType: z.enum(['THEORY', 'PRACTICE', 'COMBINED']).optional(),
    status: z.enum(['DRAFT', 'COMPLETED']).optional(),
    search: z.string().max(300).optional(),
    memberId: z.string().optional(),
  })
  .refine((value) => !value.month || value.year, 'Pro měsíc vyberte také rok.');
export function archiveWhere(input: z.infer<typeof archiveSchema>) {
  const month = input.month ?? 1;
  return {
    ...(input.year
      ? {
          date: {
            gte: new Date(Date.UTC(input.year, month - 1, 1)),
            lt: new Date(
              Date.UTC(
                input.year + (input.month ? 0 : 1),
                input.month ? month : 0,
                1,
              ),
            ),
          },
        }
      : {}),
    ...(input.trainingType ? { trainingType: input.trainingType } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.instructor
      ? {
          instructorName: {
            contains: input.instructor,
            mode: 'insensitive' as const,
          },
        }
      : {}),
    ...(input.memberId
      ? { participants: { some: { memberId: input.memberId } } }
      : {}),
    ...(input.topicId || input.category || input.search
      ? {
          topics: {
            some: {
              ...(input.topicId ? { topicId: input.topicId } : {}),
              ...(input.category ? { categorySnapshot: input.category } : {}),
              ...(input.search
                ? {
                    nameSnapshot: {
                      contains: input.search,
                      mode: 'insensitive' as const,
                    },
                  }
                : {}),
            },
          },
        }
      : {}),
  };
}
export function assertTrainingMembers(
  ids: string[],
  members: { id: string; systemAccount: boolean }[],
) {
  if (
    ids.some(
      (id) =>
        !members.some((member) => member.id === id && !member.systemAccount),
    )
  )
    throw new Error(
      'Neexistující nebo systémový účet nelze přidat do školení.',
    );
}
export function requireCompletedAcknowledgement(
  status: string,
  acknowledged: boolean,
) {
  if (status === 'COMPLETED' && !acknowledged)
    throw new Error(
      'Upravujete již dokončený záznam odborné přípravy. Je nutné výslovné potvrzení.',
    );
}
export type TrainingTopicRow = z.infer<typeof topicSchema> & { id: string };
export type TrainingMember = {
  id: string;
  firstName: string;
  lastName: string;
  primaryRole: string;
  active: boolean;
};
export type TrainingSessionRow = {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  location: string | null;
  trainingType: keyof typeof trainingTypes;
  instructorName: string;
  instructorMemberId: string | null;
  notes: string | null;
  status: keyof typeof trainingStatuses;
  updatedAt: string;
  topics: {
    topicId: string;
    nameSnapshot: string;
    categorySnapshot: string;
    subcategorySnapshot: string;
  }[];
  participants: {
    memberId: string;
    nameSnapshot: string;
    roleSnapshot: string;
    status: keyof typeof attendanceLabels;
    note: string | null;
  }[];
};
