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
function matchFor(vehicle: Vehicle, household: Household, request: Request, tables: Tables) {
  let point: Point = vehicle, seconds = 0;
  const run = tables.assignments.filter(a => a.vehicleId === vehicle.id && a.status === "accepted")
    .slice().sort((a, b) => a.stopOrder - b.stopOrder || byId(a, b));
  for (const assignment of run) {
    const pickup = tables.requests.find(r => r.id === assignment.requestId);
    const home = pickup && tables.households.find(h => h.id === pickup.householdId);
    if (!pickup || !home) return undefined; // Cannot estimate a run with missing stops safely.
    seconds += driveSeconds(point, home) + boardingSecondsFor(needsOf(pickup));
    point = home;
  }
  seconds += driveSeconds(point, household);
  const etaMinutes = Math.max(1, Math.ceil(seconds / 60));
  // Reserve after every live stop, which also clears the server's accepted-run boundary.
  const lastStop = tables.assignments.filter(a => a.vehicleId === vehicle.id && live(a))
    .reduce((last, a) => Math.max(last, a.stopOrder), 0);
  if (lastStop >= 0xffff_ffff || etaMinutes > 0xffff_ffff) return undefined;
  return {
    vehicle,
    distanceMiles: Math.round(metersBetween(vehicle, household) / 1609.344 * 10) / 10,
    etaMinutes,
    canServe: vehicleCanServe(vehicle, needsOf(request)),
    stopOrder: lastStop + 1,
  };
}

function summaryFor(home: Household, request: Request | undefined, call: Call | undefined, account: Account) {
  const record = request ?? home;
  const facts = [`${record.people} occupant${record.people === 1 ? "" : "s"}`, `mobility: ${record.mobility}`];
  if (record.assistance !== "none") facts.push(`assistance: ${record.assistance.replace(/_/g, " ")}`);
  if (record.oxygen) facts.push("oxygen required");
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
  return tables.households.map(household => {
    const request = tables.requests.find(r => r.householdId === household.id);
    const assignment = request?.status === "closed" ? undefined : tables.assignments.filter(a => a.requestId === request?.id && live(a))
      .slice().sort((a, b) => ["accepted", "offered", "proposed"].indexOf(a.status) - ["accepted", "offered", "proposed"].indexOf(b.status) || byId(b, a))[0];
    const calls = tables.calls.filter(c => c.householdId === household.id);
    const call = calls.slice().sort((a, b) => Number(OPEN_CALL.includes(b.phase)) - Number(OPEN_CALL.includes(a.phase)) || byId(b, a))[0];
    // reach=calling is the persisted ladder state; active calls also count exactly as in sweepCoverage.
    // The five-table input cannot observe scheduled reach_step rows directly.
    const account = accountFor({ canLeave: household.canLeave, reach: household.reach, request,
      ladderRunning: household.reach === "calling" || calls.some(c => OPEN_CALL.includes(c.phase)) });
    const resolved = request?.status === "closed" || account === "leaving_on_own";
    const record = request ?? household;
    const deadline = household.hazardAt ?? request?.deadlineAt;
    const score = scoreUrgency({ ...needsOf(record), minutesLeft: deadline ? (Number(deadline.toMillis()) - now) / 60_000 : Infinity, needProbability: household.needProbability });
    const urgency: CaseRow["urgency"] = resolved ? "low" : request?.escalation || score >= 300 || record.mobility === "bedbound" ? "critical"
      : score >= 200 || record.oxygen || record.mobility === "wheelchair" ? "high"
      : score >= 100 || request || account === "door_check" || account === "reaching" || account === "overlooked" ? "medium" : "low";
    const candidates = request && !resolved ? tables.vehicles.map(v => matchFor(v, household, request, tables)).filter(m => m !== undefined)
      .sort((a, b) => Number(b.canServe) - Number(a.canServe) || a.etaMinutes - b.etaMinutes || a.distanceMiles - b.distanceMiles || byId(a.vehicle, b.vehicle)) : [];
    const match = assignment ? candidates.find(m => m.vehicle.id === assignment.vehicleId) : candidates[0];
    let action: CaseAction = { kind: "none" };
    if (!resolved && request) {
      if (assignment?.status === "proposed") action = { kind: "approve", assignmentId: assignment.id };
      else if (assignment?.status === "offered") action = { kind: "driver_response", assignmentId: assignment.id };
      else if (assignment?.status === "accepted" || request.status === "arrived") action = { kind: "close", requestId: request.id };
      else if (DISPATCHABLE.includes(request.status)) action = match?.canServe
        ? { kind: "dispatch", requestId: request.id, vehicleId: match.vehicle.id, etaMinutes: match.etaMinutes, stopOrder: match.stopOrder }
        : { kind: "no_capable_unit", requestId: request.id };
    }
    const row: CaseRow = { household, request, assignment, call, account, urgency, summary: summaryFor(household, request, call, account),
      match: match && { vehicle: match.vehicle, distanceMiles: match.distanceMiles, etaMinutes: match.etaMinutes, canServe: match.canServe }, action };
    return { row, resolved, score };
  }).sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.score - a.score || byId(a.row.household, b.row.household)).map(({ row }) => row);
}
