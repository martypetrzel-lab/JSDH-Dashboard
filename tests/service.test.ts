import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FAIRNESS_SETTINGS,
  DEFAULT_SERVICE_SETTINGS,
  MISSING_DT_ERROR,
  assembleCrew,
  baseCrewEligibility,
  canCancelService,
  canHardDeleteService,
  eligibility,
  emergencyReplacementEnd,
  fromLocalDateTimeInput,
  futureRangeNeedsConfirmation,
  getReplacementAvailability,
  hardUnavailabilityIssue,
  intervalsOverlap,
  manualSelectionModes,
  manualReplacementOverrideAllowed,
  medicalValidUntil,
  memberOutages,
  nextServiceWeek,
  planCoveredSegments,
  planTemporaryReplacements,
  planTemporaryCrews,
  planWeeksSequentially,
  planningServiceWeek,
  recurringOccurrences,
  removeServiceFromPlan,
  replacementCandidates,
  replacementIntervalWarnings,
  replacementStatistics,
  serviceDeletionAuditDescription,
  serviceOperationalState,
  serviceTimeline,
  serviceWeek,
  serviceWeeksForMonth,
  servicesFromWeek,
  shouldCreateMonthDraft,
  solveCoveredWeek,
  suggestReplacement,
  validateCrew,
  validateServiceForConfirmation,
  unresolvedRecurringReplacements,
  weightedPick,
  wholeDay,
  type Assignment,
  type Candidate,
  type Role,
} from "../lib/service.ts";
import { constantTimeEqual } from "../lib/secure-compare.ts";

const base = (id: string, roles: Role[], dt = false): Candidate => ({
  id,
  name: id,
  active: true,
  system: false,
  reserveOnly: false,
  dt,
  medicalExam: new Date(2026, 6, 1),
  roles,
  serviceCount: 0,
  lastService: null,
});
const week = {
  start: new Date("2026-09-07T04:00:00.000Z"),
  end: new Date("2026-09-14T04:00:00.000Z"),
};
test("zdravotní prohlídka platí přesně dva roky", () =>
  assert.equal(medicalValidUntil(new Date(2026, 6, 21))?.getFullYear(), 2028));
test("týden začíná v pondělí 06:00 a končí následující pondělí 06:00 pražského času", () => {
  const w = serviceWeek(new Date("2026-09-09T10:00:00Z"));
  assert.deepEqual(w, week);
});

test("září 2026 obsahuje čtyři navazující služby a poslední končí v říjnu", () => {
  const weeks = serviceWeeksForMonth("2026-09");
  assert.equal(weeks.length, 4);
  assert.equal(weeks[0].start.toISOString(), "2026-09-07T04:00:00.000Z");
  assert.equal(weeks[3].end.toISOString(), "2026-10-05T04:00:00.000Z");
  for (let index = 1; index < weeks.length; index += 1)
    assert.equal(weeks[index - 1].end.getTime(), weeks[index].start.getTime());
});

test("pokud měsíc začíná v pondělí, zahrne se služba od prvního dne", () => {
  const weeks = serviceWeeksForMonth("2026-06");
  assert.equal(weeks[0].start.toISOString(), "2026-06-01T04:00:00.000Z");
  assert.equal(weeks.length, 5);
});
test("intervaly na společné hranici se nepřekrývají", () =>
  assert.equal(
    intervalsOverlap(new Date(0), new Date(10), new Date(10), new Date(20)),
    false,
  ));
test("propadlá zdravotní vyřadí člena", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.medicalExam = new Date(2020, 1, 1);
  assert.equal(
    eligibility(m, "FIREFIGHTER", week.start, week.end).eligible,
    false,
  );
});
test("výběr používá zdravotní platnost uloženou u člena v databázi", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.medicalExam = null;
  m.medicalValidUntil = new Date("2027-01-01T00:00:00Z");
  assert.equal(
    eligibility(m, "FIREFIGHTER", week.start, week.end).eligible,
    true,
  );
});
test("pouze na počet není automaticky losován", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.reserveOnly = true;
  assert.ok(
    eligibility(m, "FIREFIGHTER", week.start, week.end).reasons.includes(
      "pouze na počet",
    ),
  );
});
test("systémový účet není losován", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.system = true;
  assert.equal(
    eligibility(m, "FIREFIGHTER", week.start, week.end).eligible,
    false,
  );
});
test("překrývající nedostupnost vyřadí kandidáta z konkrétního časového záskoku", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.unavailable = [
    { from: new Date("2026-09-10"), to: new Date("2026-09-11") },
  ];
  assert.equal(
    eligibility(m, "FIREFIGHTER", week.start, week.end).eligible,
    false,
  );
});
test("nedostupnost zachovává přesné hodiny", () => {
  const from = fromLocalDateTimeInput("2026-09-10T18:00")!,
    to = fromLocalDateTimeInput("2026-09-11T06:00")!;
  assert.equal(from.toISOString(), "2026-09-10T16:00:00.000Z");
  assert.equal(to.toISOString(), "2026-09-11T04:00:00.000Z");
});
test("překryv pouze části dne neblokuje výběr základní týdenní posádky", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.unavailable = [
    {
      from: new Date("2026-09-10T16:00:00Z"),
      to: new Date("2026-09-11T04:00:00Z"),
    },
  ];
  assert.equal(
    baseCrewEligibility(m, "FIREFIGHTER", week.start, week.end).eligible,
    true,
  );
});
test("AUTO sestava ponechá částečně nedostupného člena a řeší jen jeho interval", () => {
  const unavailable = base("h-nedostupny", ["FIREFIGHTER"]);
  unavailable.unavailable = [{
    from: new Date("2026-09-10T06:00:00Z"),
    to: new Date("2026-09-10T16:00:00Z"),
  }];
  const result = solveCoveredWeek([
    base("v", ["COMMANDER"], true),
    base("s", ["DRIVER"]),
    unavailable,
    base("h1", ["FIREFIGHTER"]),
    base("h2", ["FIREFIGHTER"]),
  ], week.start, week.end, 1, DEFAULT_FAIRNESS_SETTINGS, () => 0);
  assert.ok(result.plan);
  assert.equal(result.plan!.crew.some((item) => item.member.id === unavailable.id), true);
  assert.deepEqual(memberOutages(unavailable, week.start, week.end), [{ from: new Date("2026-09-10T06:00:00Z"), to: new Date("2026-09-10T16:00:00Z"), source: "UNAVAILABILITY" }]);
  assert.ok(result.plan!.replacements.some((item) => item.originalMemberId === unavailable.id));
});
test("hodinová nedostupnost vytvoří pouze přesný hodinový outage", () => {
  const member = base("hodinova-absence", ["FIREFIGHTER"]), from = new Date("2026-09-09T08:00:00Z"), to = new Date("2026-09-09T09:00:00Z");
  member.unavailable = [{ from, to }];
  assert.equal(baseCrewEligibility(member, "FIREFIGHTER", week.start, week.end).eligible, true);
  assert.deepEqual(memberOutages(member, week.start, week.end), [{ from, to, source: "UNAVAILABILITY" }]);
});
test("nedostupnost končící přesně při začátku služby neblokuje", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.unavailable = [{ from: new Date("2026-09-06T04:00:00Z"), to: week.start }];
  assert.equal(
    eligibility(m, "FIREFIGHTER", week.start, week.end).eligible,
    true,
  );
});
test("nedostupnost mimo týden člena nevyřadí", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.unavailable = [{ from: week.end, to: new Date("2026-09-15T04:00:00Z") }];
  assert.equal(
    eligibility(m, "FIREFIGHTER", week.start, week.end).eligible,
    true,
  );
});
for (const [role, other] of [
  ["COMMANDER", "DRIVER"],
  ["DRIVER", "FIREFIGHTER"],
  ["FIREFIGHTER", "COMMANDER"],
] as [Role, Role][])
  test(`${role} vyžaduje správné oprávnění`, () =>
    assert.equal(
      eligibility(base("a", [other]), role, week.start, week.end).eligible,
      false,
    ));
test("stejná osoba nesmí být dvakrát", () => {
  const m = base("a", ["COMMANDER", "DRIVER", "FIREFIGHTER"], true);
  const a: Assignment[] = [
    { role: "COMMANDER", member: m, mode: "AUTO" },
    { role: "DRIVER", member: m, mode: "AUTO" },
    { role: "FIREFIGHTER", member: m, mode: "AUTO" },
    { role: "FIREFIGHTER", member: m, mode: "AUTO" },
  ];
  assert.equal(validateCrew(a).valid, false);
});
test("posádka má přesně 4 osoby, 1 velitele, 1 strojníka, 2 hasiče a DT", () => {
  const a: Assignment[] = [
    ["COMMANDER", base("v", ["COMMANDER"], true)],
    ["DRIVER", base("s", ["DRIVER"])],
    ["FIREFIGHTER", base("h1", ["FIREFIGHTER"])],
    ["FIREFIGHTER", base("h2", ["FIREFIGHTER"])],
  ].map(([role, member]) => ({
    role: role as Role,
    member: member as Candidate,
    mode: "AUTO",
  }));
  assert.equal(validateCrew(a).valid, true);
});
test("bez DT nelze posádku potvrdit", () => {
  const a: Assignment[] = [
    ["COMMANDER", base("v", ["COMMANDER"])],
    ["DRIVER", base("s", ["DRIVER"])],
    ["FIREFIGHTER", base("h1", ["FIREFIGHTER"])],
    ["FIREFIGHTER", base("h2", ["FIREFIGHTER"])],
  ].map(([role, member]) => ({
    role: role as Role,
    member: member as Candidate,
    mode: "AUTO",
  }));
  assert.ok(validateCrew(a).errors.includes(MISSING_DT_ERROR));
});
test("backtracking uchová jediného velitele pro pozici velitele", () => {
  const people = [
    base("kriticky", ["COMMANDER", "FIREFIGHTER"], true),
    base("s", ["DRIVER"]),
    base("h1", ["FIREFIGHTER"]),
    base("h2", ["FIREFIGHTER"]),
  ];
  const result = assembleCrew(people, week.start, week.end, () => 0.4);
  assert.equal(
    result?.find((a) => a.role === "COMMANDER")?.member.id,
    "kriticky",
  );
});
test("náhradní strojník nepotřebuje DT, pokud ji zajišťuje velitel", () => {
  const assignments: Assignment[] = [
    ["COMMANDER", base("v", ["COMMANDER"], true)],
    ["DRIVER", base("s", ["DRIVER"])],
    ["FIREFIGHTER", base("h1", ["FIREFIGHTER"])],
    ["FIREFIGHTER", base("h2", ["FIREFIGHTER"])],
  ].map(([role, member]) => ({
    role: role as Role,
    member: member as Candidate,
    mode: "AUTO",
  }));
  const replacement = base("ns", ["DRIVER"], false);
  assert.deepEqual(
    replacementCandidates(
      assignments,
      1,
      [replacement],
      week.start,
      week.end,
    ).map((member) => member.id),
    ["ns"],
  );
});
test("náhradní velitel musí mít DT, pokud v sestavě žádný jiný není", () => {
  const assignments: Assignment[] = [
    ["COMMANDER", base("v", ["COMMANDER"], true)],
    ["DRIVER", base("s", ["DRIVER"])],
    ["FIREFIGHTER", base("h1", ["FIREFIGHTER"])],
    ["FIREFIGHTER", base("h2", ["FIREFIGHTER"])],
  ].map(([role, member]) => ({
    role: role as Role,
    member: member as Candidate,
    mode: "AUTO",
  }));
  const without = base("nv-bez", ["COMMANDER"], false),
    withDt = base("nv-dt", ["COMMANDER"], true);
  assert.deepEqual(
    replacementCandidates(
      assignments,
      0,
      [without, withDt],
      week.start,
      week.end,
    ).map((member) => member.id),
    ["nv-dt"],
  );
  assert.equal(
    suggestReplacement(assignments, 0, [without], week.start, week.end).error,
    MISSING_DT_ERROR,
  );
});
test("pražský interval služby respektuje zimní i letní čas", () => {
  assert.equal(
    serviceWeek(new Date("2026-01-07T12:00:00Z")).start.toISOString(),
    "2026-01-05T05:00:00.000Z",
  );
  assert.equal(
    serviceWeek(new Date("2026-07-08T12:00:00Z")).start.toISOString(),
    "2026-07-06T04:00:00.000Z",
  );
});
test("neděle stále patří do služby končící v pondělí", () => {
  assert.equal(
    planningServiceWeek(new Date("2026-09-06T10:00:00Z")).start.toISOString(),
    "2026-08-31T04:00:00.000Z",
  );
});
test("plán příštího týdne navazuje přesně bez překryvu", () => {
  const current = serviceWeek(new Date("2026-09-09T10:00:00Z")),
    next = nextServiceWeek(current.start);
  assert.equal(current.end.getTime(), next.start.getTime());
});
test("postupné plánování započítá první týden a při zákazu návaznosti použije jiné členy", () => {
  const intervals = serviceWeeksForMonth("2026-09").slice(0, 2),
    people = [
      base("v1", ["COMMANDER"], true),
      base("v2", ["COMMANDER"], true),
      base("s1", ["DRIVER"]),
      base("s2", ["DRIVER"]),
      base("h1", ["FIREFIGHTER"]),
      base("h2", ["FIREFIGHTER"]),
      base("h3", ["FIREFIGHTER"]),
      base("h4", ["FIREFIGHTER"]),
    ],
    settings = {
      ...DEFAULT_SERVICE_SETTINGS,
      ...DEFAULT_FAIRNESS_SETTINGS,
      allowConsecutive: false,
    },
    result = planWeeksSequentially(intervals, people, [], settings, () => 0.2);
  assert.equal(result.planned.length, 2);
  const first = new Set(result.planned[0].crew.map((item) => item.member.id)),
    second = new Set(result.planned[1].crew.map((item) => item.member.id));
  assert.equal(
    [...second].some((id) => first.has(id)),
    false,
  );
  for (const planned of result.planned) {
    assert.equal(validateCrew(planned.crew).valid, true);
    assert.equal(new Set(planned.crew.map((item) => item.member.id)).size, 4);
  }
});
test("měsíční plán nikdy nevytváří návrh přes existující DRAFT ani CONFIRMED službu", () => {
  assert.equal(shouldCreateMonthDraft("CONFIRMED"), false);
  assert.equal(shouldCreateMonthDraft("DRAFT"), false);
  assert.equal(shouldCreateMonthDraft("CANCELLED"), false);
  assert.equal(shouldCreateMonthDraft(null), true);
});
test("hromadné potvrzení odmítne neplatnou posádku", () => {
  const assignments: Assignment[] = [
    { role: "COMMANDER", member: base("v", ["COMMANDER"]), mode: "AUTO" },
  ];
  const result = validateServiceForConfirmation(
    assignments,
    week.start,
    week.end,
    1,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /4 členy/);
});
test("ručně potvrzená výjimka může obsahovat předem odsouhlasenou nedostupnost", () => {
  const commander = base("v", ["COMMANDER"], true);
  commander.unavailable = [{ from: week.start, to: week.end }];
  const assignments: Assignment[] = [
    { role: "COMMANDER", member: commander, mode: "MANUAL" },
    { role: "DRIVER", member: base("s", ["DRIVER"]), mode: "AUTO" },
    { role: "FIREFIGHTER", member: base("h1", ["FIREFIGHTER"]), mode: "AUTO" },
    { role: "FIREFIGHTER", member: base("h2", ["FIREFIGHTER"]), mode: "AUTO" },
  ];
  assert.equal(
    validateServiceForConfirmation(assignments, week.start, week.end).valid,
    true,
  );
});
test("opakovaná směna 24/48 vytvoří dva přesné intervaly v týdnu", () => {
  const occurrences = recurringOccurrences(
    {
      anchorStart: new Date("2026-09-08T04:00:00Z"),
      durationMinutes: 1440,
      intervalMinutes: 4320,
    },
    week.start,
    week.end,
  );
  assert.deepEqual(
    occurrences.map((item) => [item.from.toISOString(), item.to.toISOString()]),
    [
      ["2026-09-08T04:00:00.000Z", "2026-09-09T04:00:00.000Z"],
      ["2026-09-11T04:00:00.000Z", "2026-09-12T04:00:00.000Z"],
    ],
  );
});
test("výskyt začínající přesně na konci týdne starý týden neovlivní", () =>
  assert.equal(
    recurringOccurrences(
      { anchorStart: week.end, durationMinutes: 1440, intervalMinutes: 4320 },
      week.start,
      week.end,
    ).length,
    0,
  ));
test("opakovaná směna nevyřadí člena ze základní posádky", () => {
  const firefighter = base("h1", ["FIREFIGHTER"]);
  firefighter.recurringUnavailable = [
    {
      anchorStart: new Date("2026-09-08T04:00:00Z"),
      durationMinutes: 1440,
      intervalMinutes: 4320,
    },
  ];
  const crew = assembleCrew(
    [
      base("v", ["COMMANDER"], true),
      base("s", ["DRIVER"]),
      firefighter,
      base("h2", ["FIREFIGHTER"]),
    ],
    week.start,
    week.end,
    () => 0.2,
  );
  assert.ok(crew?.some((item) => item.member.id === "h1"));
});
test("stejný náhradník pokryje více výpadků a mimo interval zůstává původní člen", () => {
  const original = base("h1", ["FIREFIGHTER"]),
    assignments = [
      {
        assignmentId: "a1",
        role: "COMMANDER" as Role,
        member: base("v", ["COMMANDER"], true),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a2",
        role: "DRIVER" as Role,
        member: base("s", ["DRIVER"]),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a3",
        role: "FIREFIGHTER" as Role,
        member: original,
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a4",
        role: "FIREFIGHTER" as Role,
        member: base("h2", ["FIREFIGHTER"]),
        mode: "AUTO" as const,
      },
    ],
    rules = new Map([
      [
        original.id,
        [
          {
            anchorStart: new Date("2026-09-08T04:00:00Z"),
            durationMinutes: 1440,
            intervalMinutes: 4320,
          },
        ],
      ],
    ]),
    planned = planTemporaryReplacements(
      assignments,
      rules,
      [...assignments.map((item) => item.member), base("n", ["FIREFIGHTER"])],
      week.start,
      week.end,
      1,
      () => 0.2,
    );
  assert.equal(planned.length, 2);
  assert.deepEqual(
    new Set(planned.map((item) => item.replacementMemberId)),
    new Set(["n"]),
  );
  assert.equal(
    planned.every((item) => item.originalMemberId === "h1" && item.valid),
    true,
  );
});
test("náhradník musí mít správné oprávnění", () => {
  const original = base("h1", ["FIREFIGHTER"]),
    assignments = [
      {
        assignmentId: "a1",
        role: "COMMANDER" as Role,
        member: base("v", ["COMMANDER"], true),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a2",
        role: "DRIVER" as Role,
        member: base("s", ["DRIVER"]),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a3",
        role: "FIREFIGHTER" as Role,
        member: original,
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a4",
        role: "FIREFIGHTER" as Role,
        member: base("h2", ["FIREFIGHTER"]),
        mode: "AUTO" as const,
      },
    ],
    rules = new Map([
      [
        original.id,
        [
          {
            anchorStart: new Date("2026-09-08T04:00:00Z"),
            durationMinutes: 60,
            intervalMinutes: 4320,
          },
        ],
      ],
    ]),
    planned = planTemporaryReplacements(
      assignments,
      rules,
      [...assignments.map((item) => item.member), base("spatny", ["DRIVER"])],
      week.start,
      week.end,
    );
  assert.equal(planned[0].valid, false);
});
test("kandidát záskoku se validuje jen pro konkrétní interval, ne celý týden", () => {
  const commander=base("v",["COMMANDER"],true),driver=base("s",["DRIVER"]),firefighter=base("h",["FIREFIGHTER"]),missing=base("chybi",["FIREFIGHTER"]),candidate=base("nahradnik",["FIREFIGHTER"]);
  candidate.unavailable=[{from:new Date("2026-09-11T04:00:00Z"),to:new Date("2026-09-12T04:00:00Z")}];
  const assignments:Assignment[]=[{role:"COMMANDER",member:commander,mode:"AUTO"},{role:"DRIVER",member:driver,mode:"AUTO"},{role:"FIREFIGHTER",member:firefighter,mode:"AUTO"},{role:"FIREFIGHTER",member:missing,mode:"AUTO"}];
  assert.ok(replacementCandidates(assignments,3,[candidate],new Date("2026-09-08T04:00:00Z"),new Date("2026-09-09T04:00:00Z"),1).some((item)=>item.id===candidate.id));
  assert.equal(replacementCandidates(assignments,3,[candidate],new Date("2026-09-11T04:00:00Z"),new Date("2026-09-12T04:00:00Z"),1).length,0);
});
test("Jan Poppel není blokovaný nedostupností, která začne až po záskoku",()=>{
  const jan=base("jan-poppel",["FIREFIGHTER"]);jan.name="Jan Poppel";jan.unavailable=[{from:new Date("2026-08-14T00:00:00Z"),to:new Date("2026-08-20T00:00:00Z")}];
  const warnings=replacementIntervalWarnings(jan,new Date("2026-08-07T04:00:00Z"),new Date("2026-08-09T21:59:00Z"));
  assert.equal(warnings.includes("Nahlášená nedostupnost"),false);
});
test("replacement availability vrací konkrétní blokující DB interval a respektuje hranice",()=>{
  const jan=base("jan-poppel",["FIREFIGHTER"]),blocked={from:new Date("2026-08-14T04:00:00Z"),to:new Date("2026-08-15T04:00:00Z")};jan.unavailable=[blocked];
  assert.deepEqual(getReplacementAvailability(jan,new Date("2026-08-07T04:00:00Z"),new Date("2026-08-09T21:59:00Z")),{available:true,blockingUnavailability:null,blockingRecurring:null});
  assert.deepEqual(getReplacementAvailability(jan,new Date("2026-09-07T04:00:00Z"),new Date("2026-09-09T21:59:00Z")),{available:true,blockingUnavailability:null,blockingRecurring:null});
  assert.equal(getReplacementAvailability(jan,new Date("2026-08-14T08:00:00Z"),new Date("2026-08-14T18:00:00Z")).blockingUnavailability,blocked);
  assert.equal(getReplacementAvailability(jan,blocked.to,new Date(blocked.to.getTime()+3600000)).available,true);
  assert.equal(getReplacementAvailability(jan,new Date(blocked.from.getTime()-3600000),blocked.from).available,true);
});
test("Jan Poppel je blokovaný pouze při skutečném překryvu záskoku",()=>{
  const jan=base("jan-poppel",["FIREFIGHTER"]);jan.name="Jan Poppel";jan.unavailable=[{from:new Date("2026-08-08T10:00:00Z"),to:new Date("2026-08-09T10:00:00Z")}];
  assert.deepEqual(replacementIntervalWarnings(jan,new Date("2026-08-07T04:00:00Z"),new Date("2026-08-09T21:59:00Z")),["Nahlášená nedostupnost"]);
});

test("API a dialog podporují automatickou i ruční volbu náhradníka",()=>{
  const create=readFileSync("app/api/services/[id]/replacements/route.ts","utf8"),edit=readFileSync("app/api/services/[id]/replacements/[replacementId]/route.ts","utf8"),helper=readFileSync("lib/emergency-replacement-server.ts","utf8"),ui=readFileSync("app/weekly-planning-module.tsx","utf8");
  assert.match(create,/replacementMemberId/);assert.match(edit,/replacementMemberId/);assert.match(edit,/TEMP_REPLACEMENT_CHANGED/);
  assert.match(helper,/requestedMemberId/);assert.match(helper,/getReplacementAvailability\(candidate, from, to\)/);assert.match(helper,/blockingIntervals/);assert.match(helper,/busyIds/);
  assert.match(ui,/Automaticky vybrat/);assert.match(ui,/replacement-candidates/);assert.match(ui,/Upravit dočasnou sestavu/);
});
test("ruční override dovolí nedostupného člena i člena v pracovní směně",()=>{
  const member=base("manual",["FIREFIGHTER"]),from=new Date("2026-09-08T04:00:00Z"),to=new Date("2026-09-08T16:00:00Z");
  member.unavailable=[{from:new Date("2026-09-08T05:00:00Z"),to:new Date("2026-09-08T06:00:00Z")}];
  member.recurringUnavailable=[{anchorStart:new Date("2026-09-08T04:00:00Z"),durationMinutes:60,intervalMinutes:4320}];
  assert.equal(getReplacementAvailability(member,from,to).available,false);
  assert.equal(manualReplacementOverrideAllowed(member),true);
});
test("ruční override dovolí člena bez oprávnění, DT, zdravotní i pouze na počet",()=>{
  const member=base("manual",[],false);
  member.medicalExam=null;member.medicalValidUntil=null;member.reserveOnly=true;member.active=false;
  assert.equal(eligibility(member,"COMMANDER",week.start,week.end).eligible,false);
  assert.equal(manualReplacementOverrideAllowed(member),true);
});
test("systémový účet zůstává zakázaný i pro ruční override",()=>{
  const member=base("system",["FIREFIGHTER"]);member.system=true;
  assert.equal(manualReplacementOverrideAllowed(member),false);
});
test("automatický záskok nadále používá přísná pravidla",()=>{
  const original=base("original",["FIREFIGHTER"]),candidate=base("candidate",["DRIVER"],false);
  candidate.unavailable=[{from:week.start,to:week.end}];
  const assignments:Assignment[]=[
    {role:"COMMANDER",member:base("commander",["COMMANDER"],true),mode:"AUTO"},
    {role:"DRIVER",member:base("driver",["DRIVER"]),mode:"AUTO"},
    {role:"FIREFIGHTER",member:base("firefighter",["FIREFIGHTER"]),mode:"AUTO"},
    {role:"FIREFIGHTER",member:original,mode:"AUTO"},
  ];
  assert.deepEqual(replacementCandidates(assignments,3,[candidate],week.start,week.end,1),[]);
});
test("API ukládá vynucený záskok jako platný MANUAL override s auditem",()=>{
  const create=readFileSync("app/api/services/[id]/replacements/route.ts","utf8"),edit=readFileSync("app/api/services/[id]/replacements/[replacementId]/route.ts","utf8"),helper=readFileSync("lib/emergency-replacement-server.ts","utf8"),ui=readFileSync("app/weekly-planning-module.tsx","utf8"),schema=readFileSync("prisma/schema.prisma","utf8");
  assert.match(create,/forceManualOverride/);assert.match(edit,/forceManualOverride/);
  assert.match(create,/TEMP_REPLACEMENT_MANUAL_OVERRIDE/);assert.match(edit,/TEMP_REPLACEMENT_MANUAL_OVERRIDE/);
  assert.match(create,/manualOverride/);assert.match(edit,/manualOverride/);assert.match(schema,/manualOverride\s+Boolean\s+@default\(false\)/);
  assert.match(helper,/!forceManualOverride && !option\.eligible/);assert.match(helper,/manualReplacementOverrideAllowed/);
  assert.match(ui,/Vybraný člen nesplňuje některá standardní pravidla/);assert.match(ui,/forceManualOverride: Boolean\(outageReplacementMemberId\)/);assert.match(ui,/RUČNÍ ZÁSKOK/);assert.match(ui,/Ručně vynuceno/);
  assert.doesNotMatch(ui,/replacementCandidates\.map\(\(candidate\)=>\s*<option[^>]*disabled=/);
});
test("DT náhradníka závisí na celé výsledné čtveřici", () => {
  const original = base("h1", ["FIREFIGHTER"], true),
    assignments = [
      {
        assignmentId: "a1",
        role: "COMMANDER" as Role,
        member: base("v", ["COMMANDER"]),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a2",
        role: "DRIVER" as Role,
        member: base("s", ["DRIVER"]),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a3",
        role: "FIREFIGHTER" as Role,
        member: original,
        mode: "AUTO" as const,
      },
      {
        assignmentId: "a4",
        role: "FIREFIGHTER" as Role,
        member: base("h2", ["FIREFIGHTER"]),
        mode: "AUTO" as const,
      },
    ],
    rules = new Map([
      [
        original.id,
        [
          {
            anchorStart: new Date("2026-09-08T04:00:00Z"),
            durationMinutes: 60,
            intervalMinutes: 4320,
          },
        ],
      ],
    ]),
    without = base("bez-dt", ["FIREFIGHTER"]),
    withDt = base("s-dt", ["FIREFIGHTER"], true),
    planned = planTemporaryReplacements(
      assignments,
      rules,
      [...assignments.map((item) => item.member), without, withDt],
      week.start,
      week.end,
    );
  assert.equal(planned[0].replacementMemberId, "s-dt");
  assignments[0].member.dt = true;
  const second = planTemporaryReplacements(
    assignments,
    rules,
    [...assignments.map((item) => item.member), without],
    week.start,
    week.end,
  );
  assert.equal(second[0].replacementMemberId, "bez-dt");
});
test("náhradníkovi se počítají záskoky a hodiny, nikoli celý týden", () => {
  const stats = replacementStatistics([
    {
      replacementMemberId: "n",
      from: new Date(0),
      to: new Date(6 * 3600000),
      valid: true,
    },
    {
      replacementMemberId: "n",
      from: new Date(10 * 3600000),
      to: new Date(14 * 3600000),
      valid: true,
    },
  ]);
  assert.deepEqual(stats.get("n"), { count: 2, hours: 10 });
});
for (const [role, slot] of [
  ["COMMANDER", 1],
  ["DRIVER", 1],
  ["FIREFIGHTER", 2],
] as [Role, number][])
  test(`ruční změna ${role} nastaví pouze změněnou pozici na MANUAL`, () => {
    const current = [
        { role, slot, memberId: "puvodni", mode: "AUTO" as const },
        {
          role: "FIREFIGHTER" as Role,
          slot: 1,
          memberId: "beze-zmeny",
          mode: "AUTO" as const,
        },
      ],
      result = manualSelectionModes(current, [
        { role, slot, memberId: "novy" },
        { role: "FIREFIGHTER", slot: 1, memberId: "beze-zmeny" },
      ]);
    assert.equal(result[0].mode, "MANUAL");
    assert.equal(result[1].mode, "AUTO");
  });
test("celý den přes přechod na letní čas končí následující půlnocí", () => {
  const range = wholeDay(new Date("2026-03-29T10:00:00Z"));
  assert.equal(range.start.toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-03-29T22:00:00.000Z");
});
test("weighted random vrátí kandidáta", () =>
  assert.equal(weightedPick([base("a", ["FIREFIGHTER"])], () => 0.5).id, "a"));
test("ruční neplatná změna je znovu odmítnuta validací", () =>
  assert.equal(validateCrew([]).valid, false));
test("serverové porovnání přihlašovacích hodnot rozliší shodu", () => {
  assert.equal(constantTimeEqual("spravne-heslo", "spravne-heslo"), true);
  assert.equal(constantTimeEqual("spatne-heslo", "spravne-heslo"), false);
});
test("DRAFT lze hard-delete bez potvrzení", () => {
  assert.equal(canHardDeleteService("DRAFT"), true);
});
test("CONFIRMED lze hard-delete pouze po potvrzení", () => {
  assert.equal(canHardDeleteService("CONFIRMED"), false);
  assert.equal(canHardDeleteService("CONFIRMED", true), true);
});
test("CANCELLED lze hard-delete pouze po potvrzení", () => {
  assert.equal(canHardDeleteService("CANCELLED"), false);
  assert.equal(canHardDeleteService("CANCELLED", true), true);
});
test("běžné zrušení již zrušené služby zůstává zakázané", () => {
  assert.equal(canCancelService("CONFIRMED"), true);
  assert.equal(canCancelService("CANCELLED"), false);
});
test("záskok do konce týdne končí přesně na weekEnd", () => {
  const selected = new Date("2026-09-10T12:00:00Z");
  assert.equal(
    emergencyReplacementEnd("UNTIL_END", selected, week.end).getTime(),
    week.end.getTime(),
  );
  assert.equal(
    emergencyReplacementEnd("CUSTOM", selected, week.end).getTime(),
    selected.getTime(),
  );
});
test("časový záskok nemění základního člena a kalendář jej použije jen v intervalu", () => {
  const crew = [
      {
        assignmentId: "a1",
        role: "DRIVER" as Role,
        memberId: "puvodni",
        name: "Martin Petržel",
      },
    ],
    replacement = {
      assignmentId: "a1",
      replacementMemberId: "novy",
      replacementName: "Michal Brož",
      from: new Date("2026-09-08T04:00:00Z"),
      to: new Date("2026-09-08T16:00:00Z"),
      valid: true,
    },
    timeline = serviceTimeline(week.start, week.end, crew, [replacement]);
  assert.equal(crew[0].memberId, "puvodni");
  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].crew[0].name, "Martin Petržel");
  assert.equal(timeline[1].crew[0].name, "Michal Brož");
  assert.equal(timeline[1].crew[0].originalName, "Martin Petržel");
  assert.equal(timeline[2].crew[0].name, "Martin Petržel");
});
test("kalendář po úplné změně používá nového základního člena", () => {
  const timeline = serviceTimeline(
    week.start,
    week.end,
    [
      {
        assignmentId: "a1",
        role: "DRIVER",
        memberId: "novy",
        name: "Michal Brož",
      },
    ],
    [],
  );
  assert.equal(timeline[0].crew[0].name, "Michal Brož");
});
test("nevyřešený výpadek označí službu jako Vyžaduje záskok", () => {
  assert.deepEqual(
    serviceOperationalState("CONFIRMED", true, [{ valid: false }]),
    { kind: "replacement", label: "Vyžaduje záskok" },
  );
  assert.deepEqual(serviceOperationalState("CANCELLED", true, []), {
    kind: "cancelled",
    label: "Zrušena",
  });
});
test("nevyřešený záskok zůstává neplatný a je vidět v časové ose", () => {
  const from = new Date("2026-09-08T04:00:00Z"), to = new Date("2026-09-09T04:00:00Z"),
    timeline = serviceTimeline(week.start, week.end, [{ assignmentId: "a1", role: "FIREFIGHTER", memberId: "m1", name: "Petržel Martin" }], [{ assignmentId: "a1", replacementMemberId: null, replacementName: null, from, to, valid: false }]),
    unresolved = timeline.find((segment) => segment.from.getTime() === from.getTime())!.crew[0];
  assert.equal(unresolved.memberId, "m1");
  assert.equal(unresolved.replaced, false);
  assert.equal(unresolved.unresolved, true);
});
test("potvrzení služby vyžaduje explicitní override, ale neoznačí záskok jako platný", () => {
  const route = readFileSync("app/api/services/[id]/confirm/route.ts", "utf8"), ui = readFileSync("app/weekly-planning-module.tsx", "utf8"), shareUi = readFileSync("app/service-app.tsx", "utf8"), replacementEdit = readFileSync("app/api/services/[id]/replacements/[replacementId]/route.ts", "utf8");
  assert.match(route, /allowUnresolvedReplacements/);
  assert.match(route, /requiresOverrideConfirmation: true/);
  assert.match(route, /Služba obsahuje nevyřešený záskok/);
  assert.match(route, /WEEK_CONFIRMED_WITH_UNRESOLVED_REPLACEMENT/);
  assert.match(route, /Týdenní služba byla administrátorem potvrzena i přes nevyřešený záskok/);
  assert.match(route, /where: \{ serviceId: id, valid: false \}/);
  assert.doesNotMatch(route, /valid: true/);
  assert.doesNotMatch(route, /missing\.length\)return NextResponse\.json\(\{error:/);
  assert.match(ui, /Potvrdit i s nevyřešeným záskokem/);
  assert.match(ui, /body: JSON\.stringify\(\{ allowUnresolvedReplacements \}\)/);
  assert.doesNotMatch(ui, /disabled=\{\s*busy \|\| service\.replacements\.some\(\(item\) => !item\.valid\)/);
  assert.match(shareUi, /target\.replacements\.map/);
  assert.match(shareUi, /Náhradník zatím nebyl nalezen/);
  assert.match(replacementEdit, /otherInvalid===0/);
  assert.match(replacementEdit, /needsCrewChange:false,crewIssue:null/);
});
test("ruční přehazování funkcí zachová členy a assignmentId bez kolize unikátních pozic", () => {
  const route = readFileSync("app/api/services/[id]/roles/route.ts", "utf8");
  assert.match(route, /COMMANDER-1/);
  assert.match(route, /DRIVER-1/);
  assert.match(route, /FIREFIGHTER-1/);
  assert.match(route, /FIREFIGHTER-2/);
  assert.match(route, /currentMemberIds/);
  assert.match(route, /proposedMemberIds/);
  assert.match(route, /data: \{ slot: 100 \+ index \}/);
  assert.match(route, /where: \{ id: item\.saved\.id \}/);
  assert.match(route, /roleSnapshot: item\.role/);
  assert.match(route, /selectionMode: 'MANUAL'/);
  assert.match(route, /CREW_ROLES_MANUALLY_CHANGED/);
});
test("přehazování funkcí zachová ruční záskoky a znovu spočítá pouze automatické", () => {
  const route = readFileSync("app/api/services/[id]/roles/route.ts", "utf8"), ui = readFileSync("app/weekly-planning-module.tsx", "utf8");
  assert.match(route, /serviceReplacement\.updateMany/);
  assert.match(route, /data: \{ role: item\.role \}/);
  assert.match(route, /source: 'RECURRING'/);
  assert.doesNotMatch(route, /source: 'MANUAL'[^\n]*deleteMany/);
  assert.match(route, /syncServiceReplacements\(id\)/);
  assert.match(route, /confirmedServiceAcknowledged/);
  assert.match(route, /nemá standardní oprávnění/);
  assert.match(ui, /Přehodit funkce/);
  assert.match(ui, /RUČNÍ ROZDĚLENÍ FUNKCÍ/);
  assert.match(ui, /Měníte funkce v již potvrzené službě\. Pokračovat\?/);
  assert.match(ui, /submitRoleChange\(true, true\)/);
});
test("smazání odebere pouze vybraný týden a GET jej poté nenajde", () => {
  const services = [
      { id: "tyden-1", from: "a" },
      { id: "tyden-2", from: "b" },
      { id: "tyden-3", from: "c" },
    ],
    remaining = removeServiceFromPlan(services, "tyden-2");
  assert.deepEqual(
    remaining.map((item) => item.id),
    ["tyden-1", "tyden-3"],
  );
  assert.equal(remaining.find((item) => item.id === "tyden-2") ?? null, null);
});
test("audit smazání obsahuje interval, stav, role, jména a počet záskoků bez zdravotních údajů", () => {
  const description = serviceDeletionAuditDescription({
    from: week.start,
    to: week.end,
    status: "CONFIRMED",
    crew: [
      { role: "COMMANDER", name: "Velitel Test" },
      { role: "DRIVER", name: "Strojník Test" },
    ],
    replacementCount: 2,
  });
  assert.match(description, /CONFIRMED/);
  assert.match(description, /COMMANDER: Velitel Test/);
  assert.match(description, /DRIVER: Strojník Test/);
  assert.match(description, /počet záskoků: 2/);
  assert.doesNotMatch(description, /zdravot/i);
});
test("vazby sestavy a záskoků se smažou cascade, audit nemá vazbu na službu", () => {
  const schema = readFileSync(
    new URL("../prisma/schema.prisma", import.meta.url),
    "utf8",
  );
  assert.match(
    schema,
    /model WeeklyServiceAssignment[\s\S]*service\s+WeeklyService\s+@relation\([^\n]*onDelete: Cascade/,
  );
  assert.match(
    schema,
    /model ServiceReplacement[\s\S]*service\s+WeeklyService\s+@relation\([^\n]*onDelete: Cascade/,
  );
  assert.doesNotMatch(
    schema,
    /model AuditLog[\s\S]*service\s+WeeklyService\s+@relation/,
  );
});
test("po smazání lze z aktuálních pravidel vytvořit novou validní sestavu", () => {
  const candidates = [
      base("v", ["COMMANDER"], true),
      base("s", ["DRIVER"]),
      base("h1", ["FIREFIGHTER"]),
      base("h2", ["FIREFIGHTER"]),
    ],
    crew = assembleCrew(candidates, week.start, week.end, () => 0.3);
  assert.ok(crew);
  assert.equal(
    validateServiceForConfirmation(crew!, week.start, week.end).valid,
    true,
  );
});
test("člověk z minulého týdne může být znovu použit, protože opakování je jen penalizace", () => {
  const candidates = [
      base("v", ["COMMANDER"], true),
      base("s", ["DRIVER"]),
      base("h1", ["FIREFIGHTER"]),
      base("h2", ["FIREFIGHTER"]),
    ].map((item) => ({ ...item, servedPreviousWeek: true })),
    result = solveCoveredWeek(
      candidates,
      week.start,
      week.end,
      1,
      { ...DEFAULT_FAIRNESS_SETTINGS, allowConsecutive: false },
      () => 0.1,
    );
  assert.ok(result.plan);
  assert.equal(
    result.plan!.crew.every((item) => item.member.servedPreviousWeek),
    true,
  );
});
test("coverage solver nemění férově vybranou základní posádku kvůli pracovní směně", () => {
  const bad = base("v-spatny", ["COMMANDER"]),
    good = base("v-dobry", ["COMMANDER", "FIREFIGHTER"], true);
  bad.recurringUnavailable = [
    {
      anchorStart: new Date("2026-09-08T04:00:00Z"),
      durationMinutes: 1440,
      intervalMinutes: 99999,
    },
  ];
  const result = solveCoveredWeek(
    [
      bad,
      good,
      base("s", ["DRIVER"]),
      base("h1", ["FIREFIGHTER"]),
      base("h2", ["FIREFIGHTER"]),
    ],
    week.start,
    week.end,
    1,
    DEFAULT_FAIRNESS_SETTINGS,
    () => 0,
  );
  assert.ok(result.plan);
  assert.equal(
    result.plan!.crew.find((item) => item.role === "COMMANDER")?.member.id,
    "v-spatny",
  );
  assert.ok(result.plan!.replacements.some((item) => item.originalMemberId === "v-spatny"));
});
test("platná základní posádka zůstane návrhem i s nepokrytým recurring intervalem", () => {
  const commander = base("v", ["COMMANDER"], true);
  commander.recurringUnavailable = [{ anchorStart: new Date("2026-09-08T04:00:00Z"), durationMinutes: 1440, intervalMinutes: 99999 }];
  const result = solveCoveredWeek([commander, base("s", ["DRIVER"]), base("h1", ["FIREFIGHTER"]), base("h2", ["FIREFIGHTER"])], week.start, week.end, 1, DEFAULT_FAIRNESS_SETTINGS, () => 0);
  assert.ok(result.plan);
  assert.equal(result.plan!.crew.length, 4);
  assert.ok(result.diagnostic);
});

const recurringMappingPeriod = {
  start: new Date("2026-09-14T04:00:00Z"),
  end: new Date("2026-09-21T04:00:00Z"),
  outage: new Date("2026-09-17T04:00:00Z"),
};
function recurringMappingAssignments(reverseFirefighters = false) {
  const commander = base("hel", ["COMMANDER"], true),
    driver = base("bradac", ["DRIVER"]),
    lagronova = base("lagronova", ["FIREFIGHTER"]),
    petrzel = base("petrzel-martin", ["FIREFIGHTER"]);
  commander.name = "Hél Milan";
  driver.name = "Bradáč Martin";
  lagronova.name = "Lagronová Kateřina";
  petrzel.name = "Petržel Martin";
  petrzel.recurringUnavailable = [{ anchorStart: recurringMappingPeriod.outage, durationMinutes: 1440, intervalMinutes: 99999 }];
  const firefighters = reverseFirefighters ? [petrzel, lagronova] : [lagronova, petrzel];
  return [
    { assignmentId: "assignment-hel", slot: 1, role: "COMMANDER" as Role, member: commander, mode: "AUTO" as const },
    { assignmentId: "assignment-bradac", slot: 1, role: "DRIVER" as Role, member: driver, mode: "AUTO" as const },
    ...firefighters.map((member, index) => ({ assignmentId: `assignment-${member.id}`, slot: index + 1, role: "FIREFIGHTER" as Role, member, mode: "AUTO" as const })),
  ];
}
for (const reversed of [false, true]) test(`nevyřešená směna patří Petrželovi bez ohledu na pořadí hasičů (${reversed ? "obráceně" : "běžně"})`, () => {
  const assignments = recurringMappingAssignments(reversed),
    result = planTemporaryCrews(assignments, assignments.map((item) => item.member), recurringMappingPeriod.start, recurringMappingPeriod.end),
    unresolved = unresolvedRecurringReplacements(result.diagnostic);
  assert.deepEqual(result.diagnostic?.absentAssignments, [{ assignmentId: "assignment-petrzel-martin", memberId: "petrzel-martin", role: "FIREFIGHTER", slot: reversed ? 1 : 2, source: "RECURRING" }]);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].assignmentId, "assignment-petrzel-martin");
  assert.equal(unresolved[0].originalMemberId, "petrzel-martin");
  assert.notEqual(unresolved[0].originalMemberId, "lagronova");
});
for (const target of ["COMMANDER", "DRIVER"] as const) test(`nevyřešená pracovní směna zachová přesný assignment ${target}`, () => {
  const assignments = recurringMappingAssignments(), assignment = assignments.find((item) => item.role === target)!;
  assignment.member.recurringUnavailable = [{ anchorStart: recurringMappingPeriod.outage, durationMinutes: 1440, intervalMinutes: 99999 }];
  assignments.find((item) => item.member.id === "petrzel-martin")!.member.recurringUnavailable = [];
  const diagnostic = planTemporaryCrews(assignments, assignments.map((item) => item.member), recurringMappingPeriod.start, recurringMappingPeriod.end).diagnostic;
  assert.deepEqual(diagnostic?.absentAssignments, [{ assignmentId: assignment.assignmentId, memberId: assignment.member.id, role: target, slot: 1, source: "RECURRING" }]);
  assert.equal(unresolvedRecurringReplacements(diagnostic)[0].assignmentId, assignment.assignmentId);
});
test("diagnostika zachová všechny skutečně nepřítomné pozice ve stejném intervalu", () => {
  const assignments = recurringMappingAssignments(), driver = assignments.find((item) => item.role === "DRIVER")!;
  driver.member.recurringUnavailable = [{ anchorStart: recurringMappingPeriod.outage, durationMinutes: 1440, intervalMinutes: 99999 }];
  const diagnostic = planTemporaryCrews(assignments, assignments.map((item) => item.member), recurringMappingPeriod.start, recurringMappingPeriod.end).diagnostic,
    unresolved = unresolvedRecurringReplacements(diagnostic);
  assert.deepEqual(new Set(diagnostic?.absentAssignments.map((item) => item.memberId)), new Set(["bradac", "petrzel-martin"]));
  assert.deepEqual(new Set(unresolved.map((item) => item.assignmentId)), new Set(["assignment-bradac", "assignment-petrzel-martin"]));
});
test("synchronizace mapuje recurring diagnostiku podle assignmentId a zachová ruční záskoky", () => {
  const sync = readFileSync("lib/service-replacements-server.ts", "utf8"), ui = readFileSync("app/weekly-planning-module.tsx", "utf8");
  assert.match(sync, /unresolvedRecurringReplacements\(coverage\.diagnostic\)/);
  assert.doesNotMatch(sync, /find\(\(item\) => item\.role === coverage\.diagnostic/);
  assert.match(sync, /deleteMany\(\{ where: \{ serviceId, source: "RECURRING" \} \}\)/);
  assert.match(ui, /item\.assignmentId === member\.assignmentId/);
});

test("ruční návrh má samostatný endpoint a tlačítko nepoužívá generate flow", () => {
  const ui = readFileSync("app/weekly-planning-module.tsx", "utf8"), route = readFileSync("app/api/services/manual-draft/route.ts", "utf8");
  assert.match(ui, /openManualDraft/);
  assert.match(ui, /\/api\/services\/manual-draft/);
  assert.doesNotMatch(ui, /generate\(new Date\(week\.from\), false, true\)/);
  assert.match(route, /selectionMode: "MANUAL"/);
  assert.match(route, /WEEK_DRAFT_CREATED_MANUAL/);
  assert.match(route, /syncServiceReplacements/);
});
test("dočasná posádka přesune hasiče na velitele a doplní externího hasiče bez duplicity", () => {
  const commander = base("velitel", ["COMMANDER"], true);
  commander.recurringUnavailable = [{ anchorStart: new Date("2026-09-08T04:00:00Z"), durationMinutes: 1440, intervalMinutes: 99999 }];
  const driver = base("strojnik", ["DRIVER"]);
  const internal = base("vnitrni", ["COMMANDER", "FIREFIGHTER"], true);
  const firefighter = base("hasic", ["FIREFIGHTER"]);
  const external = base("externi", ["FIREFIGHTER"]);
  const assignments = [commander, driver, internal, firefighter].map((member, index) => ({ assignmentId: `a${index}`, slot: index < 2 ? 1 : index - 1, role: (["COMMANDER", "DRIVER", "FIREFIGHTER", "FIREFIGHTER"] as Role[])[index], member, mode: "AUTO" as const }));
  const result = planTemporaryCrews(assignments, [...assignments.map((item) => item.member), external], week.start, week.end, 1, () => 0);
  assert.equal(result.diagnostic, null);
  const crew = result.plans[0].assignments;
  assert.equal(crew.find((item) => item.role === "COMMANDER")?.member.id, "vnitrni");
  assert.ok(crew.some((item) => item.role === "FIREFIGHTER" && item.member.id === "externi"));
  assert.equal(new Set(crew.map((item) => item.member.id)).size, 4);
});

test("dočasná posádka přesune hasiče na strojníka", () => {
  const driver = base("strojnik", ["DRIVER"]);
  driver.recurringUnavailable = [{ anchorStart: new Date("2026-09-08T04:00:00Z"), durationMinutes: 1440, intervalMinutes: 99999 }];
  const members = [base("velitel", ["COMMANDER"], true), driver, base("vnitrni", ["DRIVER", "FIREFIGHTER"]), base("hasic", ["FIREFIGHTER"])];
  const roles: Role[] = ["COMMANDER", "DRIVER", "FIREFIGHTER", "FIREFIGHTER"];
  const assignments = members.map((member, index) => ({ assignmentId: `d${index}`, slot: index < 2 ? 1 : index - 1, role: roles[index], member, mode: "AUTO" as const }));
  const result = planTemporaryCrews(assignments, [...members, base("externi", ["FIREFIGHTER"])], week.start, week.end, 1, () => 0);
  assert.equal(result.plans[0].assignments.find((item) => item.role === "DRIVER")?.member.id, "vnitrni");
});
test("částečně nedostupný jediný velitel zůstane v základní službě s nevyřešeným intervalem", () => {
  const commander = base("v", ["COMMANDER"], true);
  commander.unavailable = [
    {
      from: new Date("2026-09-08T04:00:00Z"),
      to: new Date("2026-09-09T04:00:00Z"),
    },
  ];
  const result = solveCoveredWeek(
    [
      commander,
      base("s", ["DRIVER"]),
      base("h1", ["FIREFIGHTER"]),
      base("h2", ["FIREFIGHTER"]),
    ],
    week.start,
    week.end,
  );
  assert.equal(result.plan?.crew.find((item) => item.role === "COMMANDER")?.member.id, "v");
  assert.ok(result.diagnostic);
});
test("pouze celotýdenní nedostupnost označí existující základní službu k výměně", () => {
  const issue = hardUnavailabilityIssue([
    {
      name: "Jan Novák",
      unavailable: [{
        from: new Date("2026-09-10T08:00:00Z"),
        to: new Date("2026-09-10T18:00:00Z"),
      }],
    },
  ], week.start, week.end);
  assert.equal(issue, null);
  assert.equal(hardUnavailabilityIssue([{ name: "Jan Novák", unavailable: [{ from: new Date(week.start.getTime() - 1), to: new Date(week.end.getTime() + 1) }] }], week.start, week.end), "Člen Jan Novák je v tomto týdnu nedostupný.");
});
test("manuální picker povolí částečně nedostupného člena a upozorní na záskok", () => {
  const source = readFileSync("app/api/services/[id]/candidates/route.ts", "utf8");
  assert.match(source, /Částečná nedostupnost bude řešena záskokem/);
  assert.match(source, /hardUnavailable/);
  assert.match(source, /available:reasons\.length===0/);
});
test("měsíční plán ponechá částečně nedostupného člena a vytvoří časové pokrytí", () => {
  const unavailable = base("h-nedostupny", ["FIREFIGHTER"]);
  unavailable.unavailable = [{
    from: new Date("2026-09-10T08:00:00Z"),
    to: new Date("2026-09-10T18:00:00Z"),
  }];
  const intervals = [
    week,
    { start: week.end, end: new Date("2026-09-21T04:00:00Z") },
  ];
  const planned = planWeeksSequentially(intervals, [
    base("v", ["COMMANDER"], true),
    base("s", ["DRIVER"]),
    unavailable,
    base("h1", ["FIREFIGHTER"]),
    base("h2", ["FIREFIGHTER"]),
  ], [], { ...DEFAULT_SERVICE_SETTINGS, ...DEFAULT_FAIRNESS_SETTINGS }, () => 0);
  assert.equal(planned.planned.length, 2);
  assert.equal(planned.planned[0].crew.some((item) => item.member.id === unavailable.id), true);
  assert.ok(planned.planned[0].replacements.some((item) => item.originalMemberId === unavailable.id));
});
test("AUTO základní posádka vyřadí člena nedostupného přes celý týden", () => {
  const unavailable = base("h-cely-tyden", ["FIREFIGHTER"]);
  unavailable.unavailable = [{ from: new Date(week.start.getTime() - 3600000), to: new Date(week.end.getTime() + 3600000) }];
  const result = solveCoveredWeek([
    base("v", ["COMMANDER"], true),
    base("s", ["DRIVER"]),
    unavailable,
    base("h1", ["FIREFIGHTER"]),
    base("h2", ["FIREFIGHTER"]),
  ], week.start, week.end, 1, DEFAULT_FAIRNESS_SETTINGS, () => 0);
  assert.ok(result.plan);
  assert.equal(result.plan!.crew.some((item) => item.member.id === unavailable.id), false);
});
test("opakované směny nesnižují šanci člena ve férovém výběru několika týdnů", () => {
  const martin = base("petrzel-martin", ["FIREFIGHTER"], true);
  martin.recurringUnavailable = [{ anchorStart: new Date("2026-09-09T04:00:00Z"), durationMinutes: 1440, intervalMinutes: 4320 }];
  const intervals = [0, 1, 2].map((offset) => ({
    start: new Date(week.start.getTime() + offset * 7 * 86400000),
    end: new Date(week.end.getTime() + offset * 7 * 86400000),
  }));
  const planned = planWeeksSequentially(intervals, [
    base("v", ["COMMANDER"], true),
    base("s", ["DRIVER"]),
    base("h1", ["FIREFIGHTER"]),
    martin,
    base("h-nahradnik", ["FIREFIGHTER"]),
  ], [], { ...DEFAULT_SERVICE_SETTINGS, ...DEFAULT_FAIRNESS_SETTINGS }, () => 0);
  const martinWeeks = planned.planned.filter((item) => item.crew.some((assignment) => assignment.member.id === martin.id));
  assert.ok(martinWeeks.length > 0);
  assert.ok(martinWeeks.some((item) => item.replacements.some((replacement) => replacement.originalMemberId === martin.id)));
  assert.doesNotMatch(readFileSync("lib/service.ts", "utf8"), /memberRecurringOutages\(left/);
});
test("DT se kontroluje v každém segmentu výsledné aktivní čtveřice", () => {
  const commander = base("v", ["COMMANDER"], true);
  commander.recurringUnavailable = [
    {
      anchorStart: new Date("2026-09-08T04:00:00Z"),
      durationMinutes: 1440,
      intervalMinutes: 99999,
    },
  ];
  const assignments = [
      {
        assignmentId: "v",
        role: "COMMANDER" as Role,
        member: commander,
        mode: "AUTO" as const,
      },
      {
        assignmentId: "s",
        role: "DRIVER" as Role,
        member: base("s", ["DRIVER"]),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "h1",
        role: "FIREFIGHTER" as Role,
        member: base("h1", ["FIREFIGHTER"]),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "h2",
        role: "FIREFIGHTER" as Role,
        member: base("h2", ["FIREFIGHTER"]),
        mode: "AUTO" as const,
      },
    ],
    without = planCoveredSegments(
      assignments,
      [...assignments.map((item) => item.member), base("nv", ["COMMANDER"])],
      week.start,
      week.end,
    ),
    withDt = planCoveredSegments(
      assignments,
      [
        ...assignments.map((item) => item.member),
        base("ndt", ["COMMANDER"], true),
      ],
      week.start,
      week.end,
    );
  assert.equal(without.diagnostic?.missingRole, "COMMANDER");
  assert.equal(withDt.diagnostic, null);
  assert.equal(withDt.replacements[0].replacementMemberId, "ndt");
});
test("více oddělených výpadků může pokrýt stejný náhradník", () => {
  const firefighter = base("h1", ["FIREFIGHTER"]);
  firefighter.recurringUnavailable = [
    {
      anchorStart: new Date("2026-09-08T04:00:00Z"),
      durationMinutes: 1440,
      intervalMinutes: 4320,
    },
  ];
  const assignments = [
      {
        assignmentId: "v",
        role: "COMMANDER" as Role,
        member: base("v", ["COMMANDER"], true),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "s",
        role: "DRIVER" as Role,
        member: base("s", ["DRIVER"]),
        mode: "AUTO" as const,
      },
      {
        assignmentId: "h1",
        role: "FIREFIGHTER" as Role,
        member: firefighter,
        mode: "AUTO" as const,
      },
      {
        assignmentId: "h2",
        role: "FIREFIGHTER" as Role,
        member: base("h2", ["FIREFIGHTER"]),
        mode: "AUTO" as const,
      },
    ],
    result = planCoveredSegments(
      assignments,
      [...assignments.map((item) => item.member), base("n", ["FIREFIGHTER"])],
      week.start,
      week.end,
    );
  assert.equal(result.diagnostic, null);
  assert.equal(result.replacements.length, 2);
  assert.deepEqual(
    new Set(result.replacements.map((item) => item.replacementMemberId)),
    new Set(["n"]),
  );
});
test("smazání od týdne dál neovlivní minulost",()=>{const services=[{id:'minuly',weekStart:new Date('2026-09-07T04:00:00Z')},{id:'vybrany',weekStart:new Date('2026-09-14T04:00:00Z')},{id:'budouci',weekStart:new Date('2026-09-21T04:00:00Z')}],targets=servicesFromWeek(services,new Date('2026-09-14T04:00:00Z'));assert.deepEqual(targets.map(item=>item.id),['vybrany','budouci']);assert.equal(targets.some(item=>item.id==='minuly'),false);});
test("potvrzené budoucí týdny vyžadují extra confirmation",()=>{assert.equal(futureRangeNeedsConfirmation([{status:'DRAFT'},{status:'CONFIRMED'}]),true);assert.equal(futureRangeNeedsConfirmation([{status:'DRAFT'}]),false);});
test("přegenerování používá aktuální data členů",()=>{const before=solveCoveredWeek([base('v',['COMMANDER'],true),base('s',['DRIVER']),base('h1',['FIREFIGHTER']),base('h2',['FIREFIGHTER'])],week.start,week.end),afterCandidates=[base('novy-v',['COMMANDER'],true),base('s',['DRIVER']),base('h1',['FIREFIGHTER']),base('h2',['FIREFIGHTER'])],after=solveCoveredWeek(afterCandidates,week.start,week.end);assert.equal(before.plan?.crew.some(item=>item.member.id==='v'),true);assert.equal(after.plan?.crew.some(item=>item.member.id==='novy-v'),true);assert.equal(after.plan?.crew.some(item=>item.member.id==='v'),false);});
