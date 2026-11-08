import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "spacetimedb";
import { buildCases } from "../../dispatchers-portal/src/lib/cases";
import type { Assignment, Call, Household, Request, Vehicle } from "../../dispatchers-portal/src/module_bindings/types";
import { accountFor } from "../../spacetimedb/src/domain/coverage";
import { needsOf, vehicleCanServe } from "../../spacetimedb/src/domain/need";

const at = (minutes: number) => Timestamp.fromDate(new Date(Date.now() + minutes * 60_000));
const home = (patch: Partial<Household> = {}): Household => ({ id: 1n, riderId: "test", name: "Test", address: "1 Test St", lat: 32.98, lng: -96.75,
  phone: "+12145550100", language: "en", simulated: true, inZone: true, reach: "reached", canLeave: false, people: 1,
  mobility: "wheelchair", assistance: "none", oxygen: false, hazardAt: undefined, needProbability: 0.5, ...patch });
const request = (patch: Partial<Request> = {}): Request => ({ id: 1n, householdId: 1n, status: "received", people: 1, mobility: "wheelchair", assistance: "none",
  oxygen: false, deadlineAt: at(90), escalation: undefined, etaMinutes: undefined, createdAt: at(-1), updatedAt: at(-1), ...patch });
const vehicle = (patch: Partial<Vehicle> = {}): Vehicle => ({ id: 1n, name: "Van", driverName: "Test", kind: "van", seats: 0, wheelchairSpaces: 1,
  stretcherSpaces: 0, crew: 1, lift: true, lat: 32.97, lng: -96.75, simulated: true, ...patch });
const assignment = (patch: Partial<Assignment> = {}): Assignment => ({ id: 1n, requestId: 1n, vehicleId: 1n, shelterId: undefined,
  planId: 1n, status: "proposed", stopOrder: 1, etaMinutes: 5, offeredAt: undefined, decidedAt: undefined, ...patch });
const call = (patch: Partial<Call> = {}): Call => ({ id: 1n, householdId: 1n, purpose: "survey", phase: "ended", attempt: 1, priority: 1,
  outcome: "no_answer", providerId: undefined, queuedAt: at(-1), endedAt: at(-1), ...patch });
const tables = (patch: Partial<Parameters<typeof buildCases>[0]> = {}): Parameters<typeof buildCases>[0] => ({ households: [home()], requests: [request()], vehicles: [vehicle()], assignments: [], calls: [], ...patch });

test("case matches use exactly the server's seats, mobility spaces, lift and crew rules", () => {
  for (const mobility of ["walks", "walker", "wheelchair", "bedbound"]) {
    for (const people of [1, 2]) for (const lift of [false, true]) for (const crew of [1, 2]) {
      const r = request({ mobility, people });
      const v = vehicle({ lift, crew, stretcherSpaces: 1 });
      const [row] = buildCases(tables({ requests: [r], vehicles: [v] }));
      const fits = vehicleCanServe(v, needsOf(r));
      assert.equal(row.match?.canServe, fits, JSON.stringify({ mobility, people, lift, crew }));
      assert.equal(row.action.kind, fits ? "dispatch" : "no_capable_unit");
    }
  }
});

test("closed requests never expose a live assignment, vehicle match or action", () => {
  for (const status of ["proposed", "offered", "accepted", "replaced", "revoked", "cancelled", "completed"]) {
    const [row] = buildCases(tables({ requests: [request({ status: "closed" })], assignments: [assignment({ status })] }));
    assert.deepEqual(row.action, { kind: "none" });
    assert.equal(row.assignment, undefined);
    assert.equal(row.match, undefined);
    assert.equal(row.account, "helped");
    assert.equal(row.urgency, "low");
  }
});

test("case actions follow only live assignments and ignore historical rows", () => {
  const history = ["declined", "expired", "replaced", "revoked", "cancelled", "completed"].map((status, i) => assignment({ id: BigInt(i + 10), status }));
  const [unassigned] = buildCases(tables({ assignments: history }));
  assert.equal(unassigned.action.kind, "dispatch");
  for (const [status, kind] of [["proposed", "approve"], ["offered", "driver_response"], ["accepted", "close"]]) {
    const [row] = buildCases(tables({ assignments: [...history, assignment({ status })] }));
    assert.equal(row.assignment?.id, 1n);
    assert.equal(row.action.kind, kind);
  }
});

test("manual dispatch appends beyond accepted stops and estimates their travel and boarding delay", () => {
  const pending = request({ id: 2n, householdId: 2n });
  const pendingHome = home({ id: 2n, lat: 32.99 });
  const base = tables({ households: [home(), pendingHome], requests: [request({ status: "driver_accepted" }), pending],
    assignments: [assignment({ status: "accepted", stopOrder: 7 })] });
  const row = buildCases(base).find(r => r.request?.id === pending.id)!;
  assert.equal(row.action.kind, "dispatch");
  if (row.action.kind !== "dispatch") throw new Error("missing dispatch action");
  assert.equal(row.action.stopOrder, 8);
  const idle = buildCases({ ...base, assignments: [] }).find(r => r.request?.id === pending.id)!;
  assert(row.action.etaMinutes > idle.match!.etaMinutes);
});

test("door-check coverage and factual summaries do not invent calls or oxygen needs", () => {
  const h = home({ mobility: "bedbound", reach: "door_check", oxygen: false, canLeave: undefined });
  const [row] = buildCases(tables({ households: [h], requests: [], calls: [call()] }));
  assert.equal(row.account, accountFor({ canLeave: h.canLeave, reach: h.reach, request: undefined, ladderRunning: false }));
  assert.match(row.summary, /bedbound/);
  assert.match(row.summary, /door check/i);
  assert.doesNotMatch(row.summary, /oxygen|currently reaching|active;|call (live|ringing|queued)/i);
  const [withOxygen] = buildCases(tables({ households: [home({ oxygen: true })], requests: [] }));
  assert.match(withOxygen.summary, /oxygen required/);
});

test("an ambulatory door-check summary explains critical urgency when hazard time passed four hours ago", t => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-08T10:00:00Z"));
  const [row] = buildCases(tables({ households: [home({ mobility: "walks", reach: "door_check", canLeave: undefined, hazardAt: at(-240) })], requests: [] }));
  assert.equal(row.urgency, "critical");
  assert.match(row.summary, /hazard time passed about 240 minutes ago/);
  assert.match(row.summary, /door check needed/);
});

test("summaries show future hazard timing and distinguish the pickup deadline fallback", t => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-08T10:00:00Z"));
  const [hazard] = buildCases(tables({ households: [home({ hazardAt: at(25) })], requests: [request({ deadlineAt: at(5) })] }));
  assert.match(hazard.summary, /hazard time in about 25 minutes/);
  assert.doesNotMatch(hazard.summary, /pickup deadline/);
  const [pickup] = buildCases(tables({ requests: [request({ deadlineAt: at(20) })] }));
  assert.match(pickup.summary, /pickup deadline in about 20 minutes/);
  assert.doesNotMatch(pickup.summary, /hazard time/);
});

test("timing summaries handle the current minute and absent timestamps without inventing a deadline", t => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-08T10:00:00Z"));
  for (const [minutes, fact] of [
    [0, "hazard time is now"], [0.5, "hazard time in less than 1 minute"], [-0.5, "hazard time passed less than 1 minute ago"],
    [1, "hazard time in about 1 minute"], [-1, "hazard time passed about 1 minute ago"],
  ] as const) {
    const [row] = buildCases(tables({ households: [home({ hazardAt: at(minutes) })], requests: [] }));
    assert(row.summary.includes(fact), row.summary);
  }
  const [unknown] = buildCases(tables({ requests: [] }));
  assert.doesNotMatch(unknown.summary, /hazard time|pickup deadline|minutes? ago/);
});

test("coverage uses current calls, pending ladder state, escalation and closed requests", () => {
  for (const phase of ["queued", "ringing", "live"]) {
    const [row] = buildCases(tables({ requests: [], calls: [call({ phase })] }));
    assert.equal(row.account, "reaching");
  }
  assert.equal(buildCases(tables({ households: [home({ reach: "calling" })], requests: [] }))[0].account, "reaching");
  assert.equal(buildCases(tables({ requests: [request({ escalation: "medical" })] }))[0].account, "escalated");
  assert.equal(buildCases(tables({ requests: [], calls: [call()] }))[0].account, "overlooked");
});

test("a nearer unfit vehicle cannot hide a capable unit or invent an available unit", () => {
  const unfit = vehicle({ id: 2n, lift: false, lat: 32.98 });
  const [row] = buildCases(tables({ vehicles: [unfit, vehicle()] }));
  assert.equal(row.match?.vehicle.id, 1n);
  assert.equal(row.action.kind, "dispatch");
  assert.equal(buildCases(tables({ vehicles: [] }))[0].action.kind, "no_capable_unit");
});

test("server urgency windows put an imminent ambulatory home before a later medical home, with resolved cases last", () => {
  const h1 = home({ id: 1n, mobility: "bedbound", hazardAt: at(100) });
  const h2 = home({ id: 2n, mobility: "walks", hazardAt: at(20) });
  const h3 = home({ id: 3n, hazardAt: at(1) });
  const rows = buildCases(tables({ households: [h1, h3, h2], requests: [request({ id: 3n, householdId: 3n, status: "closed" })] }));
  assert.deepEqual(rows.map(r => r.household.id), [2n, 1n, 3n]);
});

test("2,000-home joins index requests, calls and assignments instead of rescanning each table per household", () => {
  let keyReads = 0;
  function counted<T extends object>(row: T, key: keyof T): T {
    return new Proxy(row, { get(target, property, receiver) {
      if (property === key) keyReads++;
      return Reflect.get(target, property, receiver);
    } });
  }
  const households: Household[] = [], requests: Request[] = [], calls: Call[] = [], assignments: Assignment[] = [];
  for (let i = 1; i <= 2000; i++) {
    const id = BigInt(i);
    households.push(home({ id }));
    requests.push(counted(request({ id, householdId: id }), "householdId"));
    calls.push(counted(call({ id, householdId: id }), "householdId"));
    assignments.push(counted(assignment({ id, requestId: id, stopOrder: i }), "requestId"));
  }
  assert.equal(buildCases(tables({ households, requests, calls, assignments })).length, 2000);
  assert(keyReads < 2000 * 20, `joins read keys ${keyReads} times`);
});

test("both cleared coverage accounts sort after unresolved cases even with nearer hazards", () => {
  const rows = buildCases(tables({ households: [home({ id: 1n, canLeave: true, hazardAt: at(1) }), home({ id: 2n }), home({ id: 3n, hazardAt: at(1) })],
    requests: [request({ id: 3n, householdId: 3n, status: "closed" })] }));
  assert.equal(rows[0].household.id, 2n);
  assert.deepEqual(new Set(rows.slice(1).map(row => row.account)), new Set(["leaving_on_own", "helped"]));
});

test("idle households outside the affected zone are absent from cases and cannot be labeled overlooked", () => {
  const rows = buildCases(tables({ households: [home({ id: 1n, inZone: false, reach: "idle", canLeave: undefined }), home({ id: 2n, inZone: true, reach: "idle", canLeave: undefined })], requests: [] }));
  assert.deepEqual(rows.map(row => row.household.id), [2n]);
  assert.equal(rows[0].account, "overlooked"); // In-zone silence remains unresolved.
});
