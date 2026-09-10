import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSession } from '@/lib/auth';
import { getPrisma } from '@/lib/prisma';
import {
  archiveSchema,
  archiveWhere,
  assertTrainingMembers,
  attendanceSchema,
  primaryRoleLabels,
  requireCompletedAcknowledgement,
  sessionSchema,
  topicSchema,
} from '@/lib/training';
import type { Prisma } from '@/generated/prisma/client';

type Tx = Prisma.TransactionClient;
export const trainingInclude = { topics: true, participants: true } as const;
const memberName = (m: { firstName: string; lastName: string }) =>
  [m.firstName, m.lastName === '—' ? '' : m.lastName].filter(Boolean).join(' ');
async function audit(
  tx: Tx,
  actor: string,
  action: string,
  entityId: string,
  description: string,
  entity = 'TrainingSession',
) {
  await tx.auditLog.create({
    data: { actor, action, entity, entityId, description },
  });
}
export async function trainingRequest(
  run: (actor: string) => Promise<Response>,
) {
  const session = await getAdminSession();
  if (!session)
    return NextResponse.json(
      { error: 'Nepřihlášený přístup.' },
      { status: 401 },
    );
  try {
    return await run(session.username);
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues.map((i) => i.message).join(' ') },
        { status: 400 },
      );
    if (error && typeof error === 'object' && 'code' in error) {
      const code = error.code;
      return NextResponse.json(
        {
          error:
            code === 'P2002'
              ? 'Tento kód již existuje.'
              : code === 'P2025'
                ? 'Záznam nebyl nalezen.'
                : 'Záznam se nepodařilo uložit. Obnovte data a zkuste to znovu.',
        },
        { status: code === 'P2025' ? 404 : 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Operaci se nepodařilo provést.',
      },
      { status: 400 },
    );
  }
}
export async function topicsGet() {
  return NextResponse.json(
    await getPrisma().trainingTopic.findMany({
      where: { active: true },
      orderBy: [
        { category: 'asc' },
        { sortOrder: 'asc' },
        { subcategory: 'asc' },
        { name: 'asc' },
      ],
    }),
  );
}
export async function topicSave(request: Request, actor: string, id?: string) {
  const input = topicSchema.parse(await request.json());
  return NextResponse.json(
    await getPrisma().$transaction(async (tx) => {
      const saved = id
        ? await tx.trainingTopic.update({ where: { id }, data: input })
        : await tx.trainingTopic.create({ data: input });
      await audit(
        tx,
        actor,
        id ? 'TRAINING_TOPIC_UPDATED' : 'TRAINING_TOPIC_CREATED',
        saved.id,
        saved.name,
        'TrainingTopic',
      );
      return saved;
    }),
    { status: id ? 200 : 201 },
  );
}
export async function topicDelete(id: string, actor: string) {
  return NextResponse.json(
    await getPrisma().$transaction(async (tx) => {
      const topic = await tx.trainingTopic.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { sessions: true } } },
      });
      const deactivated = topic._count.sessions > 0;
      if (deactivated)
        await tx.trainingTopic.update({
          where: { id },
          data: { active: false },
        });
      else await tx.trainingTopic.delete({ where: { id } });
      await audit(
        tx,
        actor,
        deactivated ? 'TRAINING_TOPIC_UPDATED' : 'TRAINING_TOPIC_DELETED',
        id,
        topic.name +
          (deactivated
            ? ' – deaktivováno, archiv zachován.'
            : ' – odstraněno.'),
        'TrainingTopic',
      );
      return { deactivated };
    }),
  );
}
export async function sessionsGet(request: Request) {
  const input = archiveSchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const prisma = getPrisma();
  const year = Number(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
    }).format(new Date()),
  );
  const [sessions, completed, members, latest] = await Promise.all([
    prisma.trainingSession.findMany({
      where: archiveWhere(input),
      include: trainingInclude,
      orderBy: { date: 'desc' },
    }),
    prisma.trainingSession.findMany({
      where: { ...archiveWhere({ year }), status: 'COMPLETED' },
      select: {
        date: true,
        durationMinutes: true,
        participants: {
          where: { status: 'PRESENT' },
          select: { memberId: true },
        },
      },
      orderBy: { date: 'desc' },
    }),
    prisma.member.findMany({
      where: { active: true, systemAccount: false },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        primaryRole: true,
        active: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    prisma.trainingSession.findFirst({
      where: { status: 'COMPLETED' },
      select: { date: true },
      orderBy: { date: 'desc' },
    }),
  ]);
  return NextResponse.json({
    sessions,
    members,
    summary: {
      count: completed.length,
      minutes: completed.reduce((n, s) => n + s.durationMinutes, 0),
      attendances: completed.reduce((n, s) => n + s.participants.length, 0),
      last: latest?.date ?? null,
    },
  });
}
export async function sessionGet(id: string) {
  return NextResponse.json(
    await getPrisma().trainingSession.findUniqueOrThrow({
      where: { id },
      include: trainingInclude,
    }),
  );
}
async function participantData(
  tx: Tx,
  participants: z.infer<typeof attendanceSchema>['participants'],
  existing: {
    memberId: string;
    nameSnapshot: string;
    roleSnapshot: string;
    signedAt: Date | null;
  }[] = [],
) {
  const members = await tx.member.findMany({
    where: { id: { in: participants.map((p) => p.memberId) } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      primaryRole: true,
      systemAccount: true,
    },
  });
  assertTrainingMembers(
    participants.map((p) => p.memberId),
    members,
  );
  return participants.map((p) => {
    const m = members.find((m) => m.id === p.memberId)!;
    const previous = existing.find((e) => e.memberId === p.memberId);
    return {
      ...p,
      note: p.note ?? null,
      nameSnapshot: previous?.nameSnapshot ?? memberName(m),
      roleSnapshot: previous?.roleSnapshot ?? primaryRoleLabels[m.primaryRole],
      signedAt: previous?.signedAt ?? null,
    };
  });
}
export async function sessionSave(
  request: Request,
  actor: string,
  id?: string,
) {
  const input = sessionSchema.parse(await request.json());
  const result = await getPrisma().$transaction(async (tx) => {
    // Serialize edits, attendance changes, and deletion of the same archive record.
    if (id)
      await tx.$queryRaw`SELECT id FROM "TrainingSession" WHERE id = ${id} FOR UPDATE`;
    const previous = id
      ? await tx.trainingSession.findUniqueOrThrow({
          where: { id },
          include: trainingInclude,
        })
      : null;
    if (previous)
      requireCompletedAcknowledgement(
        previous.status,
        input.completedAcknowledged,
      );
    const topics = await tx.trainingTopic.findMany({
      where: { id: { in: input.topicIds } },
    });
    if (
      topics.length !== input.topicIds.length ||
      topics.some(
        (t) => !t.active && !previous?.topics.some((p) => p.topicId === t.id),
      )
    )
      throw new Error('Vyberte existující aktivní témata.');
    let instructorName = input.instructorName;
    if (input.instructorMemberId) {
      const member = await tx.member.findUniqueOrThrow({
        where: { id: input.instructorMemberId },
      });
      assertTrainingMembers([member.id], [member]);
      instructorName =
        previous?.instructorMemberId === member.id
          ? previous.instructorName
          : memberName(member);
    }
    const participants = await participantData(
      tx,
      input.participants,
      previous?.participants,
    );
    const topicRows = input.topicIds.map((topicId) => {
      const topic = topics.find((t) => t.id === topicId)!;
      const prior = previous?.topics.find((t) => t.topicId === topicId);
      return {
        topicId,
        nameSnapshot: prior?.nameSnapshot ?? topic.name,
        categorySnapshot: prior?.categorySnapshot ?? topic.category,
        subcategorySnapshot: prior?.subcategorySnapshot ?? topic.subcategory,
      };
    });
    const data = {
      date: new Date(input.date + 'T00:00:00Z'),
      startTime: input.startTime ? new Date(input.startTime) : null,
      endTime: input.endTime ? new Date(input.endTime) : null,
      durationMinutes: input.durationMinutes,
      location: input.location ?? null,
      trainingType: input.trainingType,
      instructorName,
      instructorMemberId: input.instructorMemberId ?? null,
      notes: input.notes ?? null,
      status: input.status,
    };
    if (id) {
      await tx.trainingSessionTopic.deleteMany({ where: { sessionId: id } });
      await tx.trainingParticipant.deleteMany({ where: { sessionId: id } });
    }
    const nested = {
      ...data,
      topics: { create: topicRows },
      participants: { create: participants },
    };
    const saved = id
      ? await tx.trainingSession.update({
          where: { id },
          data: nested,
          include: trainingInclude,
        })
      : await tx.trainingSession.create({
          data: nested,
          include: trainingInclude,
        });
    await audit(
      tx,
      actor,
      id ? 'TRAINING_SESSION_UPDATED' : 'TRAINING_SESSION_CREATED',
      saved.id,
      `${input.date}: ${topicRows.map((t) => t.nameSnapshot).join('; ')}. Stav ${input.status}.`,
    );
    if (
      previous &&
      JSON.stringify(
        previous.participants
          .map((p) => [p.memberId, p.status, p.note])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ) !==
        JSON.stringify(
          participants
            .map((p) => [p.memberId, p.status, p.note])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        )
    )
      await audit(
        tx,
        actor,
        'TRAINING_ATTENDANCE_UPDATED',
        saved.id,
        'Docházka byla aktualizována při úpravě školení.',
      );
    if (input.status === 'COMPLETED' && previous?.status !== 'COMPLETED')
      await audit(
        tx,
        actor,
        'TRAINING_SESSION_COMPLETED',
        saved.id,
        'Školení bylo dokončeno.',
      );
    return saved;
  });
  return NextResponse.json(result, { status: id ? 200 : 201 });
}
export async function sessionDelete(
  request: Request,
  id: string,
  actor: string,
) {
  const input = z
    .object({
      confirmed: z.literal(true),
      completedAcknowledged: z.boolean().default(false),
    })
    .parse(await request.json());
  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TrainingSession" WHERE id = ${id} FOR UPDATE`;
    const session = await tx.trainingSession.findUniqueOrThrow({
      where: { id },
      include: trainingInclude,
    });
    requireCompletedAcknowledgement(
      session.status,
      input.completedAcknowledged,
    );
    await audit(
      tx,
      actor,
      'TRAINING_SESSION_DELETED',
      id,
      `${session.date.toISOString().slice(0, 10)}; ${session.status}; ${session.topics.map((t) => t.nameSnapshot).join('; ')}; účastníků ${session.participants.length}.`,
    );
    await tx.trainingSession.delete({ where: { id } });
  });
  return NextResponse.json({ deleted: true });
}
export async function attendanceSave(
  request: Request,
  id: string,
  actor: string,
) {
  const input = attendanceSchema.parse(await request.json());
  return NextResponse.json(
    await getPrisma().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "TrainingSession" WHERE id = ${id} FOR UPDATE`;
      const session = await tx.trainingSession.findUniqueOrThrow({
        where: { id },
        include: trainingInclude,
      });
      requireCompletedAcknowledgement(
        session.status,
        input.completedAcknowledged,
      );
      if (session.status === 'COMPLETED' && !input.participants.length)
        throw new Error('Dokončené školení musí mít účastníky.');
      const participants = await participantData(
        tx,
        input.participants,
        session.participants,
      );
      await tx.trainingParticipant.deleteMany({ where: { sessionId: id } });
      const updated = await tx.trainingSession.update({
        where: { id },
        data: { participants: { create: participants }, updatedAt: new Date() },
        include: trainingInclude,
      });
      await audit(
        tx,
        actor,
        'TRAINING_ATTENDANCE_UPDATED',
        id,
        `Docházka byla aktualizována; členů ${participants.length}.`,
      );
      return updated;
    }),
  );
}
