import type { Assignment, Call, Household, Request, Vehicle } from "../module_bindings/types";
import { accountFor, type Account } from "../../../spacetimedb/src/domain/coverage";
import { boardingSecondsFor, needsOf, vehicleCanServe } from "../../../spacetimedb/src/domain/need";
import { driveSeconds, metersBetween, type Point } from "../../../spacetimedb/src/domain/geo";
import { LIVE_ASSIGNMENT } from "../../../spacetimedb/src/domain/status";
import { urgency as scoreUrgency } from "../../../spacetimedb/src/domain/urgency";

export type CaseAction =
  | { kind: "none" }
  | { kind: "dispatch"; requestId: bigint; vehicleId: bigint; etaMinutes: number; stopOrder: number }
  | { kind: "no_capable_unit"; requestId: bigint }
  | { kind: "approve"; assignmentId: bigint }
  | { kind: "driver_response"; assignmentId: bigint }
  | { kind: "close"; requestId: bigint };

export type CaseRow = {
  household: Household;
  request?: Request;
  assignment?: Assignment;
  call?: Call;
  account: Account;
  urgency: "critical" | "high" | "medium" | "low";
  summary: string;
  match?: { vehicle: Vehicle; distanceMiles: number; etaMinutes: number; canServe: boolean };
  action: CaseAction;
};

type Tables = { households: readonly Household[]; requests: readonly Request[]; vehicles: readonly Vehicle[]; assignments: readonly Assignment[]; calls: readonly Call[] };
const OPEN_CALL = ["queued", "ringing", "live"];
const DISPATCHABLE = ["received", "approved", "reassigning"];
const byId = (a: { id: bigint }, b: { id: bigint }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const live = (a: Assignment) => (LIVE_ASSIGNMENT as readonly string[]).includes(a.status);

// Same drive estimate as the module; accepted pickups and boarding precede a newly appended stop.
// This is an estimate from the available tables, not a road-closure or shelter-route guarantee.
function runFor(vehicle: Vehicle, assignments: readonly Assignment[], requests: ReadonlyMap<bigint, Request>, homes: ReadonlyMap<bigint, Household>) {
  let point: Point = vehicle, seconds = 0;
  const run = assignments.filter(a => a.status === "accepted")
    .slice().sort((a, b) => a.stopOrder - b.stopOrder || byId(a, b));
  for (const assignment of run) {
    const pickup = requests.get(assignment.requestId);
    const home = pickup && homes.get(pickup.householdId);
    if (!pickup || !home) return undefined; // Cannot estimate a run with missing stops safely.
    seconds += driveSeconds(point, home) + boardingSecondsFor(needsOf(pickup));
    point = home;
  }
  // Reserve after every live stop, which also clears the server's accepted-run boundary.
  const lastStop = assignments.filter(live)
    .reduce((last, a) => Math.max(last, a.stopOrder), 0);
  if (lastStop >= 0xffff_ffff) return undefined;
  return { point, seconds, stopOrder: lastStop + 1 };
}

function matchFor(vehicle: Vehicle, household: Household, request: Request, run: ReturnType<typeof runFor>) {
  if (!run) return undefined;
  const etaMinutes = Math.max(1, Math.ceil((run.seconds + driveSeconds(run.point, household)) / 60));
  if (!Number.isFinite(etaMinutes) || etaMinutes > 0xffff_ffff) return undefined;
  return {
    vehicle,
    distanceMiles: Math.round(metersBetween(vehicle, household) / 1609.344 * 10) / 10,
    etaMinutes,
    canServe: vehicleCanServe(vehicle, needsOf(request)),
    stopOrder: run.stopOrder,
  };
}

function summaryFor(home: Household, request: Request | undefined, call: Call | undefined, account: Account, now: number) {
  const record = request ?? home;
  const facts = [`${record.people} occupant${record.people === 1 ? "" : "s"}`, `mobility: ${record.mobility}`];
  if (record.assistance !== "none") facts.push(`assistance: ${record.assistance.replace(/_/g, " ")}`);
  if (record.oxygen) facts.push("oxygen required");
  const deadline = home.hazardAt ?? request?.deadlineAt;
  if (deadline) {
    const minutesLeft = (Number(deadline.toMillis()) - now) / 60_000;
    const label = home.hazardAt ? "hazard time" : "pickup deadline";
    const minutes = Math.abs(minutesLeft);
    const rounded = Math.round(minutes);
    const duration = minutes < 1 ? "less than 1 minute" : `about ${rounded} minute${rounded === 1 ? "" : "s"}`;
    facts.push(minutesLeft === 0 ? `${label} is now` : minutesLeft > 0 ? `${label} in ${duration}` : `${label} passed ${duration} ago`);
  }
  if (request) facts.push(`request ${request.status.replace(/_/g, " ")}`);
  if (request?.escalation) facts.push(`escalation: ${request.escalation.replace(/_/g, " ")}`);
  if (home.canLeave === true) facts.push("confirmed able to leave independently");
  if (home.reach === "door_check") facts.push("door check needed");
  else if (call && OPEN_CALL.includes(call.phase)) facts.push(`${call.purpose} call ${call.phase}`);
  else if (account === "reaching") facts.push("outreach ladder active; no active call recorded");
  else if (!request && home.canLeave === undefined) facts.push(home.reach === "reached" ? "reached; evacuation ability unconfirmed" : "evacuation ability unconfirmed");
  return `${facts.join("; ")}.`;
}

export function buildCases(tables: Tables): CaseRow[] {
  const now = Date.now();
  const homesById = new Map(tables.households.map(h => [h.id, h]));
  const requestsById = new Map(tables.requests.map(r => [r.id, r]));
  const requestsByHome = new Map(tables.requests.map(r => [r.householdId, r]));
  const vehiclesById = new Map(tables.vehicles.map(v => [v.id, v]));
  const callsByHome = new Map<bigint, Call>();
  const assignmentsByRequest = new Map<bigint, Assignment>();
  const assignmentsByVehicle = new Map<bigint, Assignment[]>();
  for (const c of tables.calls) {
    const previous = callsByHome.get(c.householdId);
    const rank = (call: Call) => Number(OPEN_CALL.includes(call.phase));
    if (!previous || rank(c) > rank(previous) || (rank(c) === rank(previous) &&
      (c.queuedAt.microsSinceUnixEpoch > previous.queuedAt.microsSinceUnixEpoch ||
        (c.queuedAt.microsSinceUnixEpoch === previous.queuedAt.microsSinceUnixEpoch && byId(c, previous) > 0)))) callsByHome.set(c.householdId, c);
  }
  for (const a of tables.assignments) {
    if (!live(a)) continue;
    const group = assignmentsByVehicle.get(a.vehicleId) ?? [];
    group.push(a); assignmentsByVehicle.set(a.vehicleId, group);
    const previous = assignmentsByRequest.get(a.requestId);
    const rank = (a: Assignment) => ["proposed", "offered", "accepted"].indexOf(a.status);
    if (!previous || rank(a) > rank(previous) || (rank(a) === rank(previous) && byId(a, previous) > 0)) assignmentsByRequest.set(a.requestId, a);
  }
  // Resolve each run once, rather than scanning it and looking up its households per case.
  const runs = new Map(tables.vehicles.map(v => [v.id, runFor(v, assignmentsByVehicle.get(v.id) ?? [], requestsById, homesById)]));
  return tables.households.map(household => {
    const request = requestsByHome.get(household.id);
    const assignment = request && request.status !== "closed" ? assignmentsByRequest.get(request.id) : undefined;
    const call = callsByHome.get(household.id);
    // reach=calling is the persisted ladder state; active calls also count exactly as in sweepCoverage.
    // The five-table input cannot observe scheduled reach_step rows directly.
    const account = accountFor({ canLeave: household.canLeave, reach: household.reach, request,
      ladderRunning: household.reach === "calling" || !!call && OPEN_CALL.includes(call.phase) });
    const resolved = account === "helped" || account === "leaving_on_own";
    const record = request ?? household;
    const deadline = household.hazardAt ?? request?.deadlineAt;
    const score = scoreUrgency({ ...needsOf(record), minutesLeft: deadline ? (Number(deadline.toMillis()) - now) / 60_000 : Infinity, needProbability: household.needProbability });
    const urgency: CaseRow["urgency"] = resolved ? "low" : request?.escalation || score >= 300 || record.mobility === "bedbound" ? "critical"
      : score >= 200 || record.oxygen || record.mobility === "wheelchair" ? "high"
      : score >= 100 || request || account === "door_check" || account === "reaching" || account === "overlooked" ? "medium" : "low";
    let match: ReturnType<typeof matchFor>;
    if (request && !resolved) {
      const candidates = assignment ? [vehiclesById.get(assignment.vehicleId)].filter(v => v !== undefined) : tables.vehicles;
      for (const v of candidates) {
        const candidate = matchFor(v, household, request, runs.get(v.id));
        if (candidate && (!match || Number(match.canServe) - Number(candidate.canServe) < 0 ||
          (candidate.canServe === match.canServe && (candidate.etaMinutes < match.etaMinutes ||
            (candidate.etaMinutes === match.etaMinutes && (candidate.distanceMiles < match.distanceMiles ||
              (candidate.distanceMiles === match.distanceMiles && byId(candidate.vehicle, match.vehicle) < 0))))))) match = candidate;
      }
    }
    let action: CaseAction = { kind: "none" };
    if (!resolved && request) {
      if (assignment?.status === "proposed") action = { kind: "approve", assignmentId: assignment.id };
      else if (assignment?.status === "offered") action = { kind: "driver_response", assignmentId: assignment.id };
      else if (assignment?.status === "accepted" || request.status === "arrived") action = { kind: "close", requestId: request.id };
      else if (DISPATCHABLE.includes(request.status)) action = match?.canServe
        ? { kind: "dispatch", requestId: request.id, vehicleId: match.vehicle.id, etaMinutes: match.etaMinutes, stopOrder: match.stopOrder }
        : { kind: "no_capable_unit", requestId: request.id };
    }
    const row: CaseRow = { household, request, assignment, call, account, urgency, summary: summaryFor(household, request, call, account, now),
      match: match && { vehicle: match.vehicle, distanceMiles: match.distanceMiles, etaMinutes: match.etaMinutes, canServe: match.canServe }, action };
    return { row, resolved, score };
  }).sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.score - a.score || byId(a.row.household, b.row.household)).map(({ row }) => row);
}
