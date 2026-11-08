import { TimeDuration } from "spacetimedb";
import { t } from "spacetimedb/server";
import { replanJob, spacetimedb } from "./schema";
import { liveAssignments, needsOf, nowMs, revokeAccepted, runAt, type Tx } from "./core";
import { writePlan, type PlannedOffer } from "./plans";
import { driveSeconds, metersToSegment, type Point } from "./domain/geo";
import { boardingSecondsFor, loadFor, vehicleCanServe, weightFor } from "./domain/need";
import { isSolution, type Problem, type Solution } from "./domain/problem";
import { solveHeuristic } from "./domain/heuristic";
import { requireInternal } from "./authorization";

// The real dispatcher. A scheduled procedure snapshots the world in one transaction, asks the
// solver service (or the heuristic when it is unset, slow or down), and commits through writePlan
// in a second transaction that re-checks every row it touches.

const REPLAN_EVERY_MS = 5_000;
const SOLVER_TIMEOUT_MS = 4_000;
const SHIFT_SECONDS = 6 * 3600;
// A closure this close to the straight line between two points blocks it. The road graph replaces
// this test once the city's drive network is loaded.
const CLOSURE_METERS = 150;
const OPEN_REQUEST = ["received", "approved", "reassigning"];

function dispatchState(tx: Tx) {
  return tx.db.dispatchState.id.find(0) ?? tx.db.dispatchState.insert({ id: 0, running: false, lastReplanAt: undefined, roadVersion: 0n, roadVersionSeen: 0n });
}

export function requestReplan(tx: Tx, now: boolean) {
  const state = dispatchState(tx);
  if (state.running) return;
  const due = !state.lastReplanAt || nowMs(tx) - Number(state.lastReplanAt.toMillis()) >= REPLAN_EVERY_MS;
  if (!now && !due && state.roadVersion === state.roadVersionSeen) return;
  tx.db.dispatchState.id.update({ ...state, running: true });
  tx.db.replanJob.insert({ scheduledId: 0n, scheduledAt: runAt(tx, 0) });
}

type Closure = Point;

function blocked(a: Point, b: Point, closures: Closure[]) {
  return closures.some((c) => metersToSegment(c, a, b) < CLOSURE_METERS);
}

type World = { problem: Problem; vehicleIds: bigint[]; requestIds: bigint[]; shelterIds: bigint[]; plannedAt: number };

export function buildWorld(tx: Tx): World {
  const now = nowMs(tx);
  const closures = [...tx.db.roadClosure.active.filter(true)];
  const busy = new Set([...tx.db.assignment.status.filter("accepted")].map((a) => a.vehicleId));
  const vehicles = [...tx.db.vehicle.iter()].filter((v) => !busy.has(v.id));
  const shelters = [...tx.db.shelter.iter()];
  const requests = [...tx.db.request.iter()].filter(
    (r) => OPEN_REQUEST.includes(r.status) && liveAssignments(tx, r.id, ["accepted"]).length === 0,
  );
  const homes = requests.map((r) => tx.db.household.id.find(r.householdId)!);
  const locations: Point[] = [...vehicles, ...homes, ...shelters].map(({ lat, lng }) => ({ lat, lng }));
  const matrix = locations.map((a) => locations.map((b) => (blocked(a, b, closures) ? null : driveSeconds(a, b))));
  const vehicleIndex = new Map(vehicles.map((v, i) => [v.id, i]));

  const problem: Problem = {
    policy: "alns",
    locations,
    matrix,
    vehicles: vehicles.map((v, i) => ({
      id: String(v.id),
      location: i,
      availableAt: 0,
      endBy: SHIFT_SECONDS,
      seats: v.seats,
      wheelchairSpaces: v.wheelchairSpaces,
      stretcherSpaces: v.stretcherSpaces,
    })),
    requests: requests.map((r, i) => {
      const needs = needsOf(r);
      const open = liveAssignments(tx, r.id, ["proposed", "offered"])[0];
      return {
        id: String(r.id),
        location: vehicles.length + i,
        load: loadFor(needs),
        boardingSeconds: boardingSecondsFor(needs),
        deadline: Math.round((Number(r.deadlineAt.toMillis()) - now) / 1000),
        weight: weightFor(needs),
        allowedVehicles: vehicles.flatMap((v, k) => (vehicleCanServe(v, needs) ? [k] : [])),
        openOfferVehicle: open ? (vehicleIndex.get(open.vehicleId) ?? null) : null,
        maxRideSeconds: needs.oxygen ? 3600 : null,
        reassigned: r.status === "reassigning",
      };
    }),
    shelters: shelters.map((s, i) => ({ id: String(s.id), location: vehicles.length + homes.length + i, capacity: s.capacity })),
    timeLimitSeconds: 3,
  };
  return { problem, vehicleIds: vehicles.map((v) => v.id), requestIds: requests.map((r) => r.id), shelterIds: shelters.map((s) => s.id), plannedAt: now };
}

type Http = { fetch(url: string, init: { method: string; headers: Record<string, string>; body: string; timeout: TimeDuration }): { ok: boolean; status: number; json(): unknown } };

export function solve(problem: Problem, http: Http, url: string | undefined, token: string | undefined): { solution: Solution; fallbackReason?: string } {
  if (problem.requests.length === 0) return { solution: { routes: [], dropped: [], solver: "heuristic", solveMs: 0 } };
  if (!url) return { solution: solveHeuristic(problem), fallbackReason: "no solver service configured" };
  try {
    const response = http.fetch(`${url.replace(/\/$/, "")}/solve`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(problem),
      timeout: TimeDuration.fromMillis(SOLVER_TIMEOUT_MS),
    });
    if (!response.ok) return { solution: solveHeuristic(problem), fallbackReason: `solver answered ${response.status}` };
    const body = response.json();
    if (!isSolution(body)) return { solution: solveHeuristic(problem), fallbackReason: "solver answered an unknown shape" };
    return { solution: body };
  } catch (error) {
    return { solution: solveHeuristic(problem), fallbackReason: error instanceof Error ? error.message : String(error) };
  }
}

// Accepted pickups whose vehicle can no longer reach the rider before the deadline.
function unreachable(tx: Tx) {
  const closures = [...tx.db.roadClosure.active.filter(true)];
  const now = nowMs(tx);
  const revoke: { assignmentId: bigint; reason: string }[] = [];
  for (const a of tx.db.assignment.status.filter("accepted")) {
    const request = tx.db.request.id.find(a.requestId);
    const vehicle = tx.db.vehicle.id.find(a.vehicleId);
    const home = request && tx.db.household.id.find(request.householdId);
    if (!request || !vehicle || !home || request.status === "arrived" || request.status === "closed") continue;
    if (blocked(vehicle, home, closures)) revoke.push({ assignmentId: a.id, reason: "a closed road cuts the only way in" });
    else if (now + driveSeconds(vehicle, home) * 1000 > Number(request.deadlineAt.toMillis())) {
      revoke.push({ assignmentId: a.id, reason: "no route reaches the rider before the deadline" });
    }
  }
  return revoke;
}

export function commit(tx: Tx, world: World, solution: Solution, fallbackReason?: string) {
  for (const r of unreachable(tx)) {
    const a = tx.db.assignment.id.find(r.assignmentId);
    if (a?.status === "accepted") revokeAccepted(tx, a, "revoked", r.reason);
  }
  const offers: PlannedOffer[] = [];
  const replace: bigint[] = [];
  const escalate: bigint[] = [];
  for (const route of solution.routes) {
    const vehicleId = BigInt(route.vehicle);
    const firstDrop = route.stops.findIndex((s) => s.kind === "dropoff");
    const trip = route.stops.slice(0, firstDrop === -1 ? route.stops.length : firstDrop).filter((s) => s.kind === "pickup");
    const used = [...tx.db.assignment.vehicleId.filter(vehicleId)].reduce((max, a) => Math.max(max, a.stopOrder), 0);
    trip.forEach((stop, i) => {
      const requestId = BigInt(stop.request);
      const request = tx.db.request.id.find(requestId);
      if (!request || !OPEN_REQUEST.includes(request.status)) return;
      const open = liveAssignments(tx, requestId, ["proposed", "offered"])[0];
      if (open?.vehicleId === vehicleId) return;
      if (liveAssignments(tx, requestId, ["accepted"]).length > 0) return;
      if (open) replace.push(open.id);
      const dropoff = route.stops.find((s) => s.request === stop.request && s.kind === "dropoff");
      offers.push({
        requestId,
        vehicleId,
        shelterId: dropoff?.shelter ? BigInt(dropoff.shelter) : undefined,
        etaMinutes: stop.arrival / 60,
        stopOrder: used + 1 + i,
      });
      if (world.plannedAt + stop.arrival * 1000 > Number(request.deadlineAt.toMillis())) escalate.push(request.householdId);
    });
  }
  for (const id of solution.dropped) {
    const request = tx.db.request.id.find(BigInt(id));
    if (request) escalate.push(request.householdId);
  }
  if (offers.length + replace.length + escalate.length > 0 || fallbackReason) {
    writePlan(tx, { solver: solution.solver, solveMs: solution.solveMs, fallbackReason, offers, replace, revoke: [], escalate });
  }
  const state = dispatchState(tx);
  tx.db.dispatchState.id.update({ ...state, running: false, lastReplanAt: tx.timestamp, roadVersionSeen: state.roadVersion });
}

export const replan = spacetimedb.procedure({ onSchedule: replanJob }, { arg: replanJob.rowType }, t.unit(), (ctx) => {
  requireInternal(ctx);
  const world = ctx.withTx((tx) => buildWorld(tx));
  const { solution, fallbackReason } = solve(world.problem, ctx.http, ctx.env.SOLVER_URL, ctx.env.SOLVER_TOKEN);
  try {
    ctx.withTx((tx) => commit(tx, world, solution, fallbackReason));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ctx.withTx((tx) => {
      const state = dispatchState(tx);
      tx.db.dispatchState.id.update({ ...state, running: false, lastReplanAt: tx.timestamp });
      tx.db.auditLog.insert({ id: 0n, kind: "plan", message: `re-plan failed: ${reason}`, at: tx.timestamp });
    });
  }
  return {};
});
