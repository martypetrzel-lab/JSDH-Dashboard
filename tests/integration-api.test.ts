import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  effectiveIntegrationCrew,
  integrationAuthorized,
  selectCurrentConfirmedService,
  selectNextConfirmedService,
  serializeIntegrationService,
  validIntegrationMonth,
  type IntegrationServiceSource,
} from "../lib/integration-core.ts";
import { conditioningAttention, driverDuty, dtDuty } from "../lib/conditioning.ts";
import { recurringOccurrences } from "../lib/service.ts";

const weekStart = new Date("2026-09-07T04:00:00.000Z");
const weekEnd = new Date("2026-09-14T04:00:00.000Z");
const assignments = [
  { id: "a1", memberId: "m1", role: "COMMANDER", slot: 1, nameSnapshot: "První Člen", dtSnapshot: true },
  { id: "a2", memberId: "m2", role: "DRIVER", slot: 1, nameSnapshot: "Druhý Člen", dtSnapshot: false },
  { id: "a3", memberId: "m3", role: "FIREFIGHTER", slot: 1, nameSnapshot: "Třetí Člen", dtSnapshot: false },
  { id: "a4", memberId: "m4", role: "FIREFIGHTER", slot: 2, nameSnapshot: "Čtvrtý Člen", dtSnapshot: false },
];
const service = (status = "CONFIRMED"): IntegrationServiceSource => ({
  id: "service-1",
  status,
  weekStart,
  weekEnd,
  needsCrewChange: false,
  crewIssue: null,
  assignments,
  replacements: [],
});

test("integration API odmítne chybějící a špatný klíč a správný přijme", () => {
  const previous = process.env.INTEGRATION_API_KEY;
  process.env.INTEGRATION_API_KEY = "test-integration-key";
  assert.equal(integrationAuthorized(new Request("http://localhost/api/integration/current-crew")), false);
  assert.equal(integrationAuthorized(new Request("http://localhost/api/integration/current-crew", { headers: { Authorization: "Bearer wrong" } })), false);
  const request = new Request("http://localhost/api/integration/current-crew", { headers: { Authorization: "Bearer test-integration-key" } });
  assert.equal(integrationAuthorized(request), true);
  if (previous === undefined) delete process.env.INTEGRATION_API_KEY;
  else process.env.INTEGRATION_API_KEY = previous;
});

test("current crew bez aktuální potvrzené služby vrátí null", () => {
  assert.equal(selectCurrentConfirmedService([], new Date("2026-09-08T10:00:00Z")), null);
  assert.equal(selectCurrentConfirmedService([service("DRAFT")], new Date("2026-09-08T10:00:00Z")), null);
});

test("current crew najde základní potvrzenou posádku", () => {
  const current = selectCurrentConfirmedService([service()], new Date("2026-09-08T10:00:00Z"));
  assert.equal(current?.id, "service-1");
  assert.deepEqual(effectiveIntegrationCrew(service(), new Date("2026-09-08T10:00:00Z")).map((item) => item.memberId), ["m1", "m2", "m3", "m4"]);
});

test("aktivní záskok změní effective crew a DT, budoucí záskok nikoliv", () => {
  const source = service();
  source.replacements = [{
    id: "r1", assignmentId: "a1", originalMemberId: "m1", replacementMemberId: "m5", role: "COMMANDER",
    from: new Date("2026-09-08T04:00:00Z"), to: new Date("2026-09-09T04:00:00Z"), valid: true,
    issue: null, reason: "Pracovní směna", source: "RECURRING",
    originalMember: { firstName: "První", lastName: "Člen" },
    replacementMember: { firstName: "Pátý", lastName: "Člen", dt: false },
  }];
  const active = effectiveIntegrationCrew(source, new Date("2026-09-08T10:00:00Z"));
  assert.equal(active[0].memberId, "m5");
  assert.equal(active[0].replacingName, "Pátý Člen");
  assert.equal(active.filter((item) => item.dt).length, 0);
  const before = effectiveIntegrationCrew(source, new Date("2026-09-07T10:00:00Z"));
  assert.equal(before[0].memberId, "m1");
  assert.equal(before.filter((item) => item.dt).length, 1);
});
test("potvrzená služba zachová v Integration API nevyřešený záskok jako valid false", () => {
  const source = service();
  source.needsCrewChange = true;
  source.crewIssue = "Nepodařilo se automaticky sestavit náhradní posádku.";
  source.replacements = [{
    id: "unresolved", assignmentId: "a3", originalMemberId: "m3", replacementMemberId: null, role: "FIREFIGHTER",
    from: new Date("2026-09-08T04:00:00Z"), to: new Date("2026-09-09T04:00:00Z"), valid: false,
    issue: "Nenalezen vhodný náhradník.", reason: null, source: "RECURRING",
    originalMember: { firstName: "Třetí", lastName: "Člen" }, replacementMember: null,
  }];
  const at = new Date("2026-09-08T10:00:00Z"), crew = effectiveIntegrationCrew(source, at), serialized = serializeIntegrationService(source);
  assert.equal(crew.find((item) => item.assignmentId === "a3")?.unresolvedReplacement, true);
  assert.equal(serialized.status, "CONFIRMED");
  assert.equal(serialized.replacements[0].valid, false);
  assert.equal(serialized.replacements[0].replacementMemberId, null);
});
test("current crew vrací dočasné role bez duplicit", () => {
  const source = service();
  source.temporaryAssignments = [
    { id: "t1", from: new Date("2026-09-08T04:00:00Z"), to: new Date("2026-09-09T04:00:00Z"), role: "COMMANDER", slot: 1, memberId: "m4", originalAssignmentId: "a1", member: { firstName: "Čtvrtý", lastName: "Člen", dt: true } },
    { id: "t2", from: new Date("2026-09-08T04:00:00Z"), to: new Date("2026-09-09T04:00:00Z"), role: "DRIVER", slot: 1, memberId: "m2", originalAssignmentId: "a2", member: { firstName: "Druhý", lastName: "Člen", dt: false } },
    { id: "t3", from: new Date("2026-09-08T04:00:00Z"), to: new Date("2026-09-09T04:00:00Z"), role: "FIREFIGHTER", slot: 1, memberId: "m3", originalAssignmentId: "a3", member: { firstName: "Třetí", lastName: "Člen", dt: false } },
    { id: "t4", from: new Date("2026-09-08T04:00:00Z"), to: new Date("2026-09-09T04:00:00Z"), role: "FIREFIGHTER", slot: 2, memberId: "m5", originalAssignmentId: "a4", member: { firstName: "Pátý", lastName: "Člen", dt: false } },
  ];
  const crew = effectiveIntegrationCrew(source, new Date("2026-09-08T10:00:00Z"));
  assert.deepEqual(crew.map((item) => `${item.role}:${item.memberId}`), ["COMMANDER:m4", "DRIVER:m2", "FIREFIGHTER:m3", "FIREFIGHTER:m5"]);
  assert.equal(new Set(crew.map((item) => item.memberId)).size, 4);
});

test("next-service vybírá nejbližší CONFIRMED a ignoruje DRAFT", () => {
  const now = new Date("2026-09-06T10:00:00Z");
  const draft = { ...service("DRAFT"), id: "draft", weekStart: new Date("2026-09-07T04:00:00Z") };
  const later = { ...service(), id: "later", weekStart: new Date("2026-09-21T04:00:00Z") };
  const next = { ...service(), id: "next", weekStart: new Date("2026-09-14T04:00:00Z") };
  assert.equal(selectNextConfirmedService([draft, later, next], now)?.id, "next");
});

test("month přijímá pouze YYYY-MM", () => {
  assert.equal(validIntegrationMonth("2026-09"), true);
  assert.equal(validIntegrationMonth("2026-13"), false);
  assert.equal(validIntegrationMonth("09-2026"), false);
});

test("conditioning API používá tříměsíční DT a měsíční pravidla", () => {
  const member = { id: "m1", name: "První Člen", dt: true, canDrive: true };
  const dt = dtDuty(member, [{ id: "d", memberId: "m1", date: "2026-06-01", type: "CONDITIONING", cylinderNumber: "", carrierNumber: "", maskNumber: "", incidentReference: "", note: "" }], new Date("2026-09-06T10:00:00Z"), 30);
  const driver = driverDuty(member, [{ id: "j", memberId: "m1", date: "2026-09-02", type: "CONDITIONING", vehicle: "CAS", kilometers: 10, incidentReference: "", note: "" }], new Date("2026-09-06T10:00:00Z"));
  assert.equal(dt?.status, "expired");
  assert.equal(driver?.fulfilled, true);
  assert.equal(conditioningAttention({ members: [member], dtActivities: [], driverActivities: [], warningDays: 30 }, new Date("2026-09-06T10:00:00Z")).drivers.length, 1);
});

test("unavailability integrace počítá konkrétní výskyty 24/48", () => {
  assert.equal(recurringOccurrences({ anchorStart: new Date("2026-09-08T04:00:00Z"), durationMinutes: 1440, intervalMinutes: 4320 }, weekStart, weekEnd).length, 2);
  assert.match(readFileSync("app/api/integration/unavailability/route.ts", "utf8"), /recurringOccurrences/);
});

test("serializovaná integrační služba neobsahuje tajné ani osobní atributy", () => {
  const output = JSON.stringify(serializeIntegrationService(service()));
  for (const forbidden of ["ADMIN_PASSWORD", "passwordHash", "SESSION_SECRET", "INTEGRATION_API_KEY", "birthDate", "LoginAttempt", "DATABASE_URL"])
    assert.equal(output.includes(forbidden), false);
});
