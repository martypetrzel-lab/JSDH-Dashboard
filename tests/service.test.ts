import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FAIRNESS_SETTINGS,
  DEFAULT_SERVICE_SETTINGS,
  MISSING_DT_ERROR,
  assembleCrew,
  canCancelService,
  canHardDeleteService,
  eligibility,
  emergencyReplacementEnd,
  fromLocalDateTimeInput,
  futureRangeNeedsConfirmation,
  hardUnavailabilityIssue,
  intervalsOverlap,
  manualSelectionModes,
  medicalValidUntil,
  nextServiceWeek,
  planCoveredSegments,
  planTemporaryReplacements,
  planTemporaryCrews,
  planWeeksSequentially,
  planningServiceWeek,
  recurringOccurrences,
  removeServiceFromPlan,
  replacementCandidates,
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
test("překrývající nedostupnost vyřadí člena", () => {
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
test("překryv pouze části dne blokuje celý týdenní výběr", () => {
  const m = base("a", ["FIREFIGHTER"]);
  m.unavailable = [
    {
      from: new Date("2026-09-10T16:00:00Z"),
      to: new Date("2026-09-11T04:00:00Z"),
    },
  ];
  assert.equal(
    eligibility(m, "FIREFIGHTER", week.start, week.end).eligible,
    false,
  );
});
test("AUTO sestava vybere jiného člena a pro běžnou nedostupnost nevytvoří záskok", () => {
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
  assert.equal(result.plan!.crew.some((item) => item.member.id === unavailable.id), false);
  assert.equal(result.plan!.replacements.length, 0);
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
test("coverage solver odmítne nepokrytou první sestavu a zkusí jinou základní čtveřici", () => {
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
    "v-dobry",
  );
});
test("platná základní posádka zůstane návrhem i s nepokrytým recurring intervalem", () => {
  const commander = base("v", ["COMMANDER"], true);
  commander.recurringUnavailable = [{ anchorStart: new Date("2026-09-08T04:00:00Z"), durationMinutes: 1440, intervalMinutes: 99999 }];
  const result = solveCoveredWeek([commander, base("s", ["DRIVER"]), base("h1", ["FIREFIGHTER"]), base("h2", ["FIREFIGHTER"])], week.start, week.end, 1, DEFAULT_FAIRNESS_SETTINGS, () => 0);
  assert.ok(result.plan);
  assert.equal(result.plan!.crew.length, 4);
  assert.ok(result.diagnostic);
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
test("pokud je jediný velitel běžně nedostupný, základní služba se nevytvoří", () => {
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
  assert.equal(result.plan, null);
  assert.equal(result.diagnostic, null);
});
test("nová běžná nedostupnost označí existující službu k řešení", () => {
  const issue = hardUnavailabilityIssue([
    {
      name: "Jan Novák",
      unavailable: [{
        from: new Date("2026-09-10T08:00:00Z"),
        to: new Date("2026-09-10T18:00:00Z"),
      }],
    },
  ], week.start, week.end);
  assert.equal(issue, "Člen Jan Novák je v tomto týdnu nedostupný.");
});
test("manuální picker označí běžně nedostupného člena a zakáže běžný výběr", () => {
  const source = readFileSync("app/api/services/[id]/candidates/route.ts", "utf8");
  assert.match(source, /Nedostupný – běžná nedostupnost zasahuje do služby/);
  assert.match(source, /available:reasons\.length===0/);
});
test("měsíční plán vyřadí běžně nedostupného člena jen z překrývajícího týdne", () => {
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
  assert.equal(planned.planned[0].crew.some((item) => item.member.id === unavailable.id), false);
  assert.equal(planned.planned[1].crew.some((item) => item.member.id === unavailable.id), true);
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
