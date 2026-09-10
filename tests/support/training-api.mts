import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
let signedIn = true,
  serial = 0;
let topics: any[] = [],
  sessions: any[] = [],
  audits: any[] = [];
const members = [
  {
    id: 'martin',
    firstName: 'Martin',
    lastName: 'Testovací',
    primaryRole: 'FIREFIGHTER',
    active: true,
    systemAccount: false,
  },
  {
    id: 'matej',
    firstName: 'Matěj',
    lastName: 'Testovací',
    primaryRole: 'FIREFIGHTER',
    active: true,
    systemAccount: false,
  },
  {
    id: 'system',
    firstName: 'System',
    lastName: 'Account',
    primaryRole: 'UNASSIGNED',
    active: true,
    systemAccount: true,
  },
];
const missing = () => {
  const e = new Error('missing');
  Object.assign(e, { code: 'P2025' });
  throw e;
};
const find = (rows: any[], id: string) =>
  rows.find((r) => r.id === id) ?? missing();
const db: any = {
  $queryRaw: async () => [],
  $transaction: async (run: any) => {
    const backup = structuredClone({ topics, sessions, audits });
    try {
      return await run(db);
    } catch (e) {
      topics = backup.topics;
      sessions = backup.sessions;
      audits = backup.audits;
      throw e;
    }
  },
  auditLog: {
    create: async ({ data }: any) => {
      audits.push(data);
      return data;
    },
  },
  member: {
    findMany: async ({ where }: any) =>
      members.filter((m) =>
        typeof where.id === 'string'
          ? m.id === where.id && !m.systemAccount
          : where.id
            ? where.id.in.includes(m.id)
            : (!where.active || m.active) && !m.systemAccount,
      ),
    findUniqueOrThrow: async ({ where }: any) => find(members, where.id),
  },
  trainingTopic: {
    findMany: async ({ where }: any = {}) =>
      where?.id ? topics.filter((t) => where.id.in.includes(t.id)) : topics,
    create: async ({ data }: any) => {
      if (topics.some((t) => t.code === data.code))
        throw Object.assign(new Error(), { code: 'P2002' });
      const t = { ...data, id: 't' + ++serial };
      topics.push(t);
      return t;
    },
    update: async ({ where, data }: any) =>
      Object.assign(find(topics, where.id), data),
    findUniqueOrThrow: async ({ where }: any) => ({
      ...find(topics, where.id),
      _count: {
        sessions: sessions.filter((s) =>
          s.topics.some((t: any) => t.topicId === where.id),
        ).length,
      },
    }),
    delete: async ({ where }: any) => {
      topics = topics.filter((t) => t.id !== where.id);
    },
  },
  trainingSession: {
    findUniqueOrThrow: async ({ where }: any) =>
      structuredClone(find(sessions, where.id)),
    findMany: async ({ where }: any) =>
      sessions.filter(
        (s) =>
          (!where?.participants ||
            s.participants.some(
              (p: any) => p.memberId === where.participants.some.memberId,
            )) &&
          (!where?.status || s.status === where.status),
      ),
    findFirst: async () =>
      sessions.find((s) => s.status === 'COMPLETED') ?? null,
    create: async ({ data }: any) => {
      const s = {
        ...data,
        id: 's' + ++serial,
        topics: data.topics.create,
        participants: data.participants.create,
        updatedAt: new Date(),
      };
      sessions.push(s);
      return s;
    },
    update: async ({ where, data }: any) => {
      const s = find(sessions, where.id);
      return Object.assign(s, {
        ...data,
        ...(data.topics ? { topics: data.topics.create } : {}),
        ...(data.participants
          ? { participants: data.participants.create }
          : {}),
        updatedAt: new Date(),
      });
    },
    delete: async ({ where }: any) => {
      sessions = sessions.filter((s) => s.id !== where.id);
    },
  },
  trainingSessionTopic: { deleteMany: async () => ({ count: 0 }) },
  trainingParticipant: { deleteMany: async () => ({ count: 0 }) },
};
mock.module('../../lib/auth.ts', {
  namedExports: {
    getAdminSession: async () => (signedIn ? { username: 'test-admin' } : null),
  },
});
mock.module('../../lib/prisma.ts', { namedExports: { getPrisma: () => db } });
const topic = await import('../../app/api/training/topics/route.ts');
const topicItem = await import('../../app/api/training/topics/[id]/route.ts');
const list = await import('../../app/api/training/sessions/route.ts');
const item = await import('../../app/api/training/sessions/[id]/route.ts');
const attendance =
  await import('../../app/api/training/sessions/[id]/attendance/route.ts');
const sheet =
  await import('../../app/api/training/sessions/[id]/attendance-sheet/route.ts');
const statistics = await import('../../app/api/training/statistics/route.ts');
const statisticsMember =
  await import('../../app/api/training/statistics/member/[memberId]/route.ts');
const statisticsExport =
  await import('../../app/api/training/statistics/export/route.ts');
const statisticsMemberExport =
  await import('../../app/api/training/statistics/member/[memberId]/export/route.ts');
const request = (body: any = {}, method = 'POST', query = '') =>
  new Request('http://localhost/api/training/sessions' + query, {
    method,
    ...(method === 'GET'
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const memberCtx = (memberId: string) => ({
  params: Promise.resolve({ memberId }),
});
const statisticsRequest = (suffix = '') =>
  new Request(
    'http://localhost/api/training/statistics?from=2026-01-01&to=2026-12-31' +
      suffix,
  );
test('admin auth chrání všechny endpointy', async () => {
  signedIn = false;
  for (const response of await Promise.all([
    topic.GET(),
    topic.POST(request()),
    topicItem.PATCH(request(), ctx('x')),
    topicItem.DELETE(request(), ctx('x')),
    list.GET(request({}, 'GET')),
    list.POST(request()),
    item.GET(request({}, 'GET'), ctx('x')),
    item.PATCH(request(), ctx('x')),
    item.DELETE(request(), ctx('x')),
    attendance.PATCH(request(), ctx('x')),
    sheet.GET(request({}, 'GET'), ctx('x')),
    statistics.GET(statisticsRequest()),
    statisticsMember.GET(statisticsRequest(), memberCtx('martin')),
    statisticsExport.GET(statisticsRequest()),
    statisticsMemberExport.GET(statisticsRequest(), memberCtx('martin')),
  ]))
    assert.equal(response.status, 401);
  signedIn = true;
});
test('CRUD školení a docházky zachovává identitu, potvrzení i audit', async () => {
  const t1 = await (
    await topic.POST(
      request({
        code: 'tema-1',
        name: 'První téma',
        category: 'Test',
        subcategory: 'Obecné',
      }),
    )
  ).json();
  const t2 = await (
    await topic.POST(
      request({
        code: 'tema-2',
        name: 'Druhé téma',
        category: 'Test',
        subcategory: 'Obecné',
      }),
    )
  ).json();
  const availableTopics = await (await topic.GET()).json();
  assert.deepEqual(
    availableTopics.map((entry: any) => entry.id),
    [t1.id, t2.id],
  );
  assert.equal(
    (
      await topic.POST(
        request({
          code: 'tema-1',
          name: 'Duplicita',
          category: 'Test',
          subcategory: 'Obecné',
        }),
      )
    ).status,
    409,
  );
  const payload = {
    date: '2026-09-10',
    durationMinutes: 120,
    trainingType: 'COMBINED',
    instructorName: 'Školitel',
    topicIds: [t1.id, t2.id],
    participants: [
      { memberId: 'martin', status: 'PRESENT' },
      { memberId: 'matej', status: 'EXCUSED' },
    ],
    status: 'DRAFT',
  };
  assert.equal(
    (
      await list.POST(
        request({
          ...payload,
          participants: [{ memberId: 'system', status: 'PRESENT' }],
        }),
      )
    ).status,
    400,
  );
  assert.equal(sessions.length, 0);
  const created = await list.POST(request(payload));
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.equal(session.topics.length, 2);
  assert.equal(session.participants.length, 2);
  assert.notEqual(
    session.participants[0].memberId,
    session.participants[1].memberId,
  );
  const loaded = await (
    await item.GET(request({}, 'GET'), ctx(session.id))
  ).json();
  assert.deepEqual(
    loaded.topics.map((entry: any) => entry.topicId),
    [t1.id, t2.id],
  );
  const twoTopicPdf = await sheet.GET(request({}, 'GET'), ctx(session.id));
  assert.equal(twoTopicPdf.status, 200);
  assert.ok((await twoTopicPdf.arrayBuffer()).byteLength > 10000);
  assert.equal(
    (
      await item.PATCH(
        request({ ...payload, status: 'COMPLETED' }),
        ctx(session.id),
      )
    ).status,
    200,
  );
  assert.ok(audits.some((a) => a.action === 'TRAINING_SESSION_COMPLETED'));
  assert.equal(
    (await item.PATCH(request(payload), ctx(session.id))).status,
    400,
  );
  assert.equal(
    (
      await attendance.PATCH(
        request({ participants: payload.participants }),
        ctx(session.id),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await attendance.PATCH(
        request({
          participants: [
            { memberId: 'martin', status: 'ABSENT' },
            { memberId: 'matej', status: 'PRESENT' },
          ],
          completedAcknowledged: true,
        }),
        ctx(session.id),
      )
    ).status,
    200,
  );
  const reduced = await (
    await item.PATCH(
      request({
        ...payload,
        status: 'COMPLETED',
        topicIds: [t1.id],
        participants: [
          { memberId: 'martin', status: 'ABSENT' },
          { memberId: 'matej', status: 'PRESENT' },
        ],
        completedAcknowledged: true,
      }),
      ctx(session.id),
    )
  ).json();
  assert.deepEqual(
    reduced.topics.map((entry: any) => entry.topicId),
    [t1.id],
  );
  assert.ok(audits.some((a) => a.action === 'TRAINING_ATTENDANCE_UPDATED'));
  const overview = await (await statistics.GET(statisticsRequest())).json();
  assert.equal(overview.summary.sessions, 1);
  assert.equal(overview.summary.present, 1);
  assert.equal(overview.summary.absent, 1);
  assert.equal(overview.summary.attendancePercent, 50);
  const memberStatistics = await (
    await statisticsMember.GET(statisticsRequest(), memberCtx('matej'))
  ).json();
  assert.equal(memberStatistics.summary.present, 1);
  assert.equal(memberStatistics.sessions.length, 1);
  assert.equal(
    (await statisticsExport.GET(statisticsRequest('&details=true'))).status,
    200,
  );
  assert.equal(
    (await statisticsMemberExport.GET(statisticsRequest(), memberCtx('matej')))
      .status,
    200,
  );
  assert.ok(
    audits.some((a) => a.action === 'TRAINING_STATISTICS_PDF_GENERATED'),
  );
  assert.ok(
    audits.some((a) => a.action === 'TRAINING_MEMBER_STATISTICS_PDF_GENERATED'),
  );
  const history = await (
    await list.GET(request({}, 'GET', '?memberId=matej'))
  ).json();
  assert.equal(history.sessions.length, 1);
  const pdf = await sheet.GET(request({}, 'GET'), ctx(session.id));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok((await pdf.arrayBuffer()).byteLength > 10000);
  assert.ok(
    audits.some((a) => a.action === 'TRAINING_ATTENDANCE_SHEET_GENERATED'),
  );
  const deletedTopic = await (
    await topicItem.DELETE(request(), ctx(t1.id))
  ).json();
  assert.equal(deletedTopic.deactivated, true);
  assert.equal(
    (await item.DELETE(request({ confirmed: true }), ctx(session.id))).status,
    400,
  );
  assert.equal(sessions.length, 1);
  assert.equal(
    (
      await item.DELETE(
        request({ confirmed: true, completedAcknowledged: true }),
        ctx(session.id),
      )
    ).status,
    200,
  );
  assert.equal(sessions.length, 0);
  assert.ok(audits.some((a) => a.action === 'TRAINING_SESSION_DELETED'));
});
