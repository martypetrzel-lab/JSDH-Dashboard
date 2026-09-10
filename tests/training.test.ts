import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import {
  archiveSchema,
  archiveWhere,
  assertTrainingMembers,
  sessionSchema,
  topicSchema,
  topicMatchesSearch,
  requireCompletedAcknowledgement,
} from '../lib/training.ts';
import {
  trainingTopicCatalog,
  importTrainingTopics,
} from '../prisma/training-topics.ts';
import { createAttendancePdf } from '../lib/training-pdf.ts';
import {
  buildTrainingStatistics,
  formatTrainingMinutes,
  statisticsPeriod,
  statisticsPresetPeriod,
  trainingStatisticsQuerySchema,
} from '../lib/training-statistics.ts';
import {
  createMemberTrainingStatisticsPdf,
  createTrainingStatisticsPdf,
} from '../lib/training-statistics-pdf.ts';
import { PDFDocument } from 'pdf-lib';

const draft = {
  date: '2026-09-10',
  durationMinutes: 120,
  trainingType: 'COMBINED',
  instructorName: 'Testovací školitel',
  status: 'DRAFT',
  topicIds: ['one', 'two'],
  participants: [
    { memberId: 'martin', status: 'PRESENT' },
    { memberId: 'matej', status: 'ABSENT' },
    { memberId: 'third', status: 'EXCUSED' },
  ],
};
test('školení validuje datum, délku, více témat a všechny stavy účasti', () => {
  const input = sessionSchema.parse(draft);
  assert.equal(input.topicIds.length, 2);
  assert.equal(input.participants.length, 3);
  for (const bad of [
    { date: '2026-02-30' },
    { durationMinutes: 0 },
    { topicIds: [] },
    { topicIds: ['one', 'one'] },
    { participants: [draft.participants[0], draft.participants[0]] },
    { trainingType: 'UNKNOWN' },
  ])
    assert.equal(sessionSchema.safeParse({ ...draft, ...bad }).success, false);
  assert.equal(
    sessionSchema.safeParse({ ...draft, status: 'COMPLETED' }).success,
    true,
  );
  assert.equal(
    sessionSchema.safeParse({ ...draft, status: 'COMPLETED', participants: [] })
      .success,
    false,
  );
});
test('časy školení patří do zadaného pražského dne a mají kladný interval', () => {
  assert.equal(
    sessionSchema.safeParse({
      ...draft,
      startTime: '2026-09-10T16:00:00Z',
      endTime: '2026-09-10T18:00:00Z',
    }).success,
    true,
  );
  assert.equal(
    sessionSchema.safeParse({
      ...draft,
      startTime: '2026-09-10T18:00:00Z',
      endTime: '2026-09-10T16:00:00Z',
    }).success,
    false,
  );
  assert.equal(
    sessionSchema.safeParse({ ...draft, startTime: '2026-09-09T18:00:00Z' })
      .success,
    false,
  );
});
test('systémový a neexistující účet nelze přidat; shodné příjmení nemění identitu', () => {
  const members = [
    { id: 'martin', systemAccount: false },
    { id: 'matej', systemAccount: false },
    { id: 'system', systemAccount: true },
  ];
  assert.doesNotThrow(() =>
    assertTrainingMembers(['martin', 'matej'], members),
  );
  assert.throws(() => assertTrainingMembers(['system'], members));
  assert.throws(() => assertTrainingMembers(['unknown'], members));
});
test('dokončené školení vyžaduje výslovné potvrzení pro změnu i odstranění', () => {
  assert.throws(() => requireCompletedAcknowledgement('COMPLETED', false));
  assert.doesNotThrow(() => requireCompletedAcknowledgement('COMPLETED', true));
  assert.doesNotThrow(() => requireCompletedAcknowledgement('DRAFT', false));
});
test('archiv filtruje datum začátkem měsíce, kategorii, téma, formu, stav, školitele a memberId', () => {
  const input = archiveSchema.parse({
    year: 2026,
    month: 12,
    category: 'První pomoc',
    topicId: 'topic',
    trainingType: 'THEORY',
    status: 'COMPLETED',
    instructor: 'Školitel',
    search: 'KPR',
    memberId: 'matej',
  });
  const where = archiveWhere(input);
  assert.equal(where.date?.gte.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(where.date?.lt.toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(where.topics?.some.categorySnapshot, 'První pomoc');
  assert.equal(where.topics?.some.topicId, 'topic');
  assert.equal(where.topics?.some.nameSnapshot?.contains, 'KPR');
  assert.equal(where.participants?.some.memberId, 'matej');
  assert.equal(where.instructorName?.contains, 'Školitel');
  assert.equal(where.status, 'COMPLETED');
  assert.equal(where.trainingType, 'THEORY');
});
test('katalog obsahuje pouze Bojový a Cvičební řád s podkategoriemi a stabilními kódy', () => {
  assert.deepEqual(
    [...new Set(trainingTopicCatalog.map((t) => t.category))],
    ['Bojový řád', 'Cvičební řád'],
  );
  assert.equal(trainingTopicCatalog.length, 222);
  assert.equal(
    new Set(trainingTopicCatalog.map((t) => t.subcategory)).size,
    15,
  );
  assert.deepEqual(
    [
      ...new Set(
        trainingTopicCatalog
          .filter((topic) => topic.category === 'Bojový řád')
          .map((topic) => topic.subcategory),
      ),
    ],
    [
      'Obecné zásady',
      'Nebezpečí',
      'Řízení',
      'Ochrana obyvatelstva',
      'Požární zásah',
      'Součinnost',
      'Dopravní nehody',
      'Nebezpečné látky',
      'Technický zásah',
    ],
  );
  assert.equal(
    new Set(trainingTopicCatalog.map((t) => t.code)).size,
    trainingTopicCatalog.length,
  );
  assert.ok(
    trainingTopicCatalog.every((t) =>
      t.code.startsWith(
        t.category === 'Bojový řád' ? 'bojovy-rad-' : 'cviceny-rad-',
      ),
    ),
  );
  assert.ok(
    trainingTopicCatalog.every(
      (t) =>
        t.source === 'HasičiVzdělávání' && t.sourceType === 'HASICI_VZDELAVANI',
    ),
  );
});
test('opakovaný import nezduplikuje témata, aktualizuje metadata a zachová active', async () => {
  const store = new Map<string, Record<string, unknown>>();
  const upsert = async (topic: (typeof trainingTopicCatalog)[number]) => {
    topicSchema.parse(topic);
    const previous = store.get(topic.code);
    store.set(
      topic.code,
      previous
        ? { ...previous, ...topic, active: previous.active }
        : { ...topic, active: true },
    );
  };
  await importTrainingTopics(upsert);
  const first = trainingTopicCatalog[0];
  store.set(first.code, {
    ...store.get(first.code),
    name: 'Starý název',
    active: false,
  });
  await importTrainingTopics(upsert);
  assert.equal(store.size, 222);
  assert.equal(store.get(first.code)?.name, first.name);
  assert.equal(store.get(first.code)?.active, false);
});
test('hledání funguje přes název, oblast i podkategorii bez diakritiky', () => {
  const pruzkum = trainingTopicCatalog.find((t) => t.name === 'Průzkum')!;
  assert.equal(topicMatchesSearch(pruzkum, 'pruzkum'), true);
  assert.equal(topicMatchesSearch(pruzkum, 'obecne zasady'), true);
  assert.equal(topicMatchesSearch(pruzkum, 'cvičební'), false);
});
test('migration vytvoří tabulky, unikátní identity, cascade školení a zachová audit', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE "Member" ("id" TEXT PRIMARY KEY); CREATE TABLE "AuditLog" ("id" TEXT PRIMARY KEY);',
    );
    await db.exec(
      readFileSync(
        'prisma/migrations/20260909180000_training/migration.sql',
        'utf8',
      ),
    );
    await db.exec(
      readFileSync(
        'prisma/migrations/20260909210000_training_topic_subcategory/migration.sql',
        'utf8',
      ),
    );
    await db.exec(`INSERT INTO "Member" VALUES ('martin'),('matej');
      INSERT INTO "TrainingTopic" ("id","code","name","category","subcategory","updatedAt") VALUES ('t','topic','Téma','Test','Podkategorie',now());
      INSERT INTO "TrainingSession" ("id","date","durationMinutes","trainingType","instructorName","updatedAt") VALUES ('s','2026-09-10',120,'COMBINED','Test',now());
      INSERT INTO "TrainingSessionTopic" ("id","sessionId","topicId","nameSnapshot","categorySnapshot","subcategorySnapshot") VALUES ('st','s','t','Téma','Test','Podkategorie');
      INSERT INTO "TrainingParticipant" ("id","sessionId","memberId","status","nameSnapshot","roleSnapshot") VALUES ('p1','s','martin','PRESENT','Martin','Hasič'),('p2','s','matej','EXCUSED','Matěj','Hasič');
      INSERT INTO "AuditLog" VALUES ('audit');`);
    await assert.rejects(db.exec(`DELETE FROM "TrainingTopic" WHERE id='t'`));
    await assert.rejects(
      db.exec(
        `INSERT INTO "TrainingTopic" ("id","code","name","category","subcategory","updatedAt") VALUES ('duplicate','topic','Téma','Test','Podkategorie',now())`,
      ),
    );
    await db.exec(`DELETE FROM "TrainingSession" WHERE id='s'`);
    assert.equal(
      (await db.query('SELECT * FROM "TrainingParticipant"')).rows.length,
      0,
    );
    assert.equal(
      (await db.query('SELECT * FROM "TrainingSessionTopic"')).rows.length,
      0,
    );
    assert.equal((await db.query('SELECT * FROM "AuditLog"')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM "Member"')).rows.length, 2);
  } finally {
    await db.close();
  }
});
test('PDF s českou diakritikou a mnoha účastníky má A4 a více stran', async () => {
  const bytes = await createAttendancePdf({
    id: 'test',
    date: '2026-09-10',
    startTime: '2026-09-10T16:00:00Z',
    endTime: '2026-09-10T18:00:00Z',
    durationMinutes: 120,
    location: 'Zbrojnice',
    trainingType: 'COMBINED',
    instructorName: 'Školitel Červený',
    instructorMemberId: null,
    notes: 'ě š č ř ž ý á í é ú ů ď ť ň',
    status: 'COMPLETED',
    updatedAt: '2026-09-10',
    topics: Array.from({ length: 40 }, (_, i) => ({
      topicId: `t-${i}`,
      nameSnapshot: `Téma odborné přípravy číslo ${i + 1}`,
      categorySnapshot: i < 20 ? 'Bojový řád' : 'Cvičební řád',
      subcategorySnapshot: i % 2 === 0 ? 'Obecné zásady' : 'Praktický výcvik',
    })),
    participants: Array.from({ length: 55 }, (_, i) => ({
      memberId: String(i),
      nameSnapshot: 'Testovací Člen ' + i,
      roleSnapshot: 'Velitel družstva',
      status: 'PRESENT',
      note: null,
    })),
  });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 3);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.28) < 0.01);
  assert.ok(bytes.length > 10000);
});
test('training endpointy: autentizace, CRUD, dokončení, docházka a PDF', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--experimental-test-module-mocks',
      '--test',
      'tests/support/training-api.mts',
    ],
    { encoding: 'utf8', timeout: 60000, env },
  );
  assert.equal(child.status, 0, child.stdout + '\n' + child.stderr);
  assert.match(child.stdout, /tests 2/);
});

const statisticsFixture = (activeOnly = false) =>
  buildTrainingStatistics(
    [
      { id: 'a', firstName: 'Žaneta', lastName: 'Černá', active: true },
      { id: 'b', firstName: 'Aleš', lastName: 'Říha', active: true },
      { id: 'c', firstName: 'Člen', lastName: 'Bez účasti', active: false },
      {
        id: 'system',
        firstName: 'Poplachový',
        lastName: 'uživatel',
        active: true,
        systemAccount: true,
      },
    ],
    [
      {
        id: 'completed-1',
        date: '2026-09-03',
        durationMinutes: 120,
        status: 'COMPLETED',
        topics: [
          {
            topicId: 't1',
            nameSnapshot: 'Průzkum',
            categorySnapshot: 'Bojový řád',
            subcategorySnapshot: 'Obecné zásady',
          },
        ],
        participants: [
          { memberId: 'a', status: 'PRESENT' },
          { memberId: 'b', status: 'ABSENT' },
          { memberId: 'system', status: 'PRESENT' },
        ],
      },
      {
        id: 'completed-2',
        date: '2026-09-17',
        durationMinutes: 90,
        status: 'COMPLETED',
        topics: [
          {
            topicId: 't2',
            nameSnapshot: 'Výcvik s hadicemi',
            categorySnapshot: 'Cvičební řád',
            subcategorySnapshot: 'Obecná činnost při technickém výcviku',
          },
          {
            topicId: 't3',
            nameSnapshot: 'Pracovní uzly',
            categorySnapshot: 'Cvičební řád',
            subcategorySnapshot: 'Obecná činnost při technickém výcviku',
          },
        ],
        participants: [
          { memberId: 'a', status: 'PRESENT' },
          { memberId: 'b', status: 'EXCUSED' },
        ],
      },
      {
        id: 'draft',
        date: '2026-09-24',
        durationMinutes: 300,
        status: 'DRAFT',
        topics: [],
        participants: [{ memberId: 'a', status: 'ABSENT' }],
      },
      {
        id: 'outside-period',
        date: '2026-10-01',
        durationMinutes: 180,
        status: 'COMPLETED',
        topics: [],
        participants: [{ memberId: 'a', status: 'PRESENT' }],
      },
    ],
    { from: '2026-09-01', to: '2026-09-30' },
    activeOnly,
  );

test('statistika účasti počítá pouze dokončená školení a všechny attendance stavy', () => {
  const statistics = statisticsFixture();
  assert.deepEqual(statistics.summary, {
    sessions: 2,
    durationMinutes: 210,
    present: 2,
    absent: 1,
    excused: 1,
    attendanceRecords: 4,
    attendancePercent: 50,
  });
  const present = statistics.members.find((member) => member.id === 'a')!;
  const missing = statistics.members.find((member) => member.id === 'b')!;
  const empty = statistics.members.find((member) => member.id === 'c')!;
  assert.equal(present.durationMinutes, 210);
  assert.equal(present.attendancePercent, 100);
  assert.equal(present.lastAttendance, '2026-09-17');
  assert.equal(missing.durationMinutes, 0);
  assert.equal(missing.attendancePercent, 0);
  assert.equal(empty.attendancePercent, null);
  assert.equal(
    statistics.members.some((member) => member.id === 'system'),
    false,
  );
  assert.equal(
    statisticsFixture(true).members.some((member) => member.id === 'c'),
    false,
  );
  assert.equal(formatTrainingMinutes(90), '1 h 30 min');
});

test('měsíční, roční a vlastní období používá celé kalendářní dny', () => {
  const now = new Date('2026-09-10T10:00:00.000Z');
  const month = statisticsPresetPeriod('THIS_MONTH', now);
  const previousMonth = statisticsPresetPeriod('LAST_MONTH', now);
  const year = statisticsPresetPeriod('THIS_YEAR', now);
  const custom = statisticsPeriod('2026-03-29', '2026-03-29');
  assert.deepEqual([month.from, month.to], ['2026-09-01', '2026-09-30']);
  assert.deepEqual(
    [previousMonth.from, previousMonth.to],
    ['2026-08-01', '2026-08-31'],
  );
  assert.deepEqual([year.from, year.to], ['2026-01-01', '2026-12-31']);
  assert.equal(custom.fromDate.toISOString(), '2026-03-29T00:00:00.000Z');
  assert.equal(custom.toExclusive.toISOString(), '2026-03-30T00:00:00.000Z');
  assert.equal(
    trainingStatisticsQuerySchema.parse({
      from: '2026-01-01',
      to: '2026-12-31',
      activeOnly: 'false',
    }).activeOnly,
    false,
  );
});

test('PDF statistiky za měsíc, rok i člena podporuje češtinu a stránkování', async () => {
  const month = statisticsFixture();
  const year = { ...month, period: { from: '2026-01-01', to: '2026-12-31' } };
  const monthPdf = await PDFDocument.load(
    await createTrainingStatisticsPdf(month, true),
  );
  const yearPdf = await PDFDocument.load(
    await createTrainingStatisticsPdf(year, false),
  );
  const memberPdf = await PDFDocument.load(
    await createMemberTrainingStatisticsPdf(month, month.members[0]),
  );
  assert.ok(monthPdf.getPageCount() >= 3);
  assert.equal(yearPdf.getTitle(), 'Přehled odborné přípravy a účasti členů');
  assert.equal(memberPdf.getTitle(), 'Přehled odborné přípravy člena');
  assert.ok(Math.abs(monthPdf.getPage(0).getWidth() - 841.89) < 0.01);
});
