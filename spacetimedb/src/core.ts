import { ScheduleAt, Timestamp } from "spacetimedb";
import { SenderError, type InferSchema, type ReducerCtx } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { statusLine, type Ride } from "./domain/honesty";
import { needsOf, vehicleCanServe } from "./domain/need";
export { needsOf } from "./domain/need";
import { ANNOUNCED, canMove, isRequestStatus, LIVE_ASSIGNMENT, type AssignmentStatus, type RequestStatus } from "./domain/status";
import { DEADLINE_MARGIN_MINUTES, minutesUntilHazard } from "./domain/hazard";
import { urgency } from "./domain/urgency";

// Transaction helpers every reducer and procedure transaction shares. They take the transaction's
// db and clock, so a reducer and a procedure's withTx both call them.

export type Schema = InferSchema<typeof spacetimedb>;
export type Tx = Pick<ReducerCtx<Schema>, "db" | "timestamp" | "random">;
export type Household = NonNullable<ReturnType<Tx["db"]["household"]["id"]["find"]>>;
export type Request = NonNullable<ReturnType<Tx["db"]["request"]["id"]["find"]>>;
export type Assignment = NonNullable<ReturnType<Tx["db"]["assignment"]["id"]["find"]>>;
export type Vehicle = NonNullable<ReturnType<Tx["db"]["vehicle"]["id"]["find"]>>;
export type Control = NonNullable<ReturnType<Tx["db"]["control"]["id"]["find"]>>;

export const CONTROL_ID = 0;
export const OFFER_SECONDS = 120;

export const nowMs = (tx: Tx) => Number(tx.timestamp.toMillis());
export const at = (ms: number) => new Timestamp(BigInt(Math.round(ms)) * 1000n);
export const later = (tx: Tx, seconds: number) => at(nowMs(tx) + seconds * 1000);

export function audit(tx: Tx, kind: string, message: string) {
  tx.db.auditLog.insert({ id: 0n, kind, message, at: tx.timestamp });
}

export function control(tx: Tx): Control {
  const existing = tx.db.control.id.find(CONTROL_ID);
  if (existing) return existing;
  return tx.db.control.insert({
    id: CONTROL_ID,
    hazard: "wildfire",
    warningAt: undefined,
    generation: 0n,
    simulateVoice: true,
    simulateDispatch: false,
    simulateDrivers: true,
    autoApprove: true,
    originLat: 32.9857,
    originLng: -96.7502,
    firstArrivalMinutes: 20,
    metersPerMinute: 60,
  });
}

export function hazardAtFor(tx: Tx, home: Household) {
  const c = control(tx);
  if (!c.warningAt) return undefined;
  const minutes = minutesUntilHazard(home, {
    origin: { lat: c.originLat, lng: c.originLng },
    firstArrivalMinutes: c.firstArrivalMinutes,
    metersPerMinute: c.metersPerMinute,
  });
  return at(Number(c.warningAt.toMillis()) + minutes * 60_000);
}

export function deadlineFor(tx: Tx, home: Household) {
  const hazardAt = home.hazardAt ?? hazardAtFor(tx, home) ?? later(tx, 90 * 60);
  return at(Number(hazardAt.toMillis()) - DEADLINE_MARGIN_MINUTES * 60_000);
}

export function minutesLeft(tx: Tx, home: Household) {
  const hazardAt = home.hazardAt ?? hazardAtFor(tx, home);
  return hazardAt ? (Number(hazardAt.toMillis()) - nowMs(tx)) / 60_000 : Infinity;
}

export function urgencyOf(tx: Tx, home: Household) {
  return urgency({ ...needsOf(home), minutesLeft: minutesLeft(tx, home), needProbability: home.needProbability });
}

export function requestStatus(request: Request): RequestStatus {
  if (!isRequestStatus(request.status)) throw new Error(`request ${request.id} holds unknown status ${request.status}`);
  return request.status;
}

export function liveAssignments(tx: Tx, requestId: bigint, statuses: readonly AssignmentStatus[]) {
  return [...tx.db.assignment.requestId.filter(requestId)].filter((a) => statuses.includes(a.status as AssignmentStatus));
}

export function setAssignment(tx: Tx, assignment: Assignment, status: AssignmentStatus) {
  if (!LIVE_ASSIGNMENT.includes(status)) {
    const route = tx.db.dispatchRoute.assignmentId.find(assignment.id);
    if (route) tx.db.dispatchRoute.assignmentId.update({ ...route, state: "failed", points: [], distanceMeters: undefined, durationSeconds: undefined,
      failureReason: `Assignment ${status}`, updatedAt: tx.timestamp });
  }
  return tx.db.assignment.id.update({ ...assignment, status, decidedAt: tx.timestamp });
}

function rideFor(tx: Tx, assignment: Assignment | null): Ride | null {
  if (!assignment) return null;
  const v = tx.db.vehicle.id.find(assignment.vehicleId);
  if (!v) return null;
  return { driverName: v.driverName, vehicleKind: v.kind, crew: v.crew, etaMinutes: assignment.etaMinutes };
}

// One callback per request, assignment and announced status, by voice and by Photon message.
// A repeat is logged and dropped, so a retried reducer never calls a rider twice.
export function queueCallback(tx: Tx, request: Request, status: RequestStatus, assignment: Assignment | null) {
  const key = `${request.id}:${assignment?.id ?? "none"}:${status}`;
  if (tx.db.callback.key.find(key)) {
    audit(tx, "callback", `duplicate callback ${key} ignored`);
    return;
  }
  const line = statusLine(status, rideFor(tx, assignment));
  tx.db.callback.insert({
    id: 0n,
    key,
    requestId: request.id,
    householdId: request.householdId,
    assignmentId: assignment?.id,
    status,
    line,
    state: "pending",
    at: tx.timestamp,
  });
  queueMessage(tx, request.householdId, line, status);
}

export function queueMessage(tx: Tx, householdId: bigint, body: string, requestStatus?: RequestStatus) {
  tx.db.message.insert({
    id: 0n,
    householdId,
    direction: "out",
    state: "queued",
    body,
    requestStatus,
    providerId: undefined,
    error: undefined,
    at: tx.timestamp,
  });
}

// The only way a request's status changes. Announced statuses queue the rider's callback.
export function moveRequest(tx: Tx, request: Request, to: RequestStatus, assignment: Assignment | null = null, patch: Partial<Request> = {}) {
  const from = requestStatus(request);
  if (!canMove(from, to)) throw new SenderError(`request ${request.id} can't go from ${from} to ${to}`);
  const updated = tx.db.request.id.update({ ...request, ...patch, status: to, updatedAt: tx.timestamp });
  if (from !== to && ANNOUNCED.includes(to)) queueCallback(tx, updated, to, assignment);
  if (from !== to) audit(tx, "request", `request ${request.id}: ${from} → ${to}`);
  return updated;
}

// An open offer ends silently: the rider never heard about that driver.
export function endOpenOffer(tx: Tx, assignment: Assignment, status: "replaced" | "declined" | "expired") {
  setAssignment(tx, assignment, status);
  const request = tx.db.request.id.find(assignment.requestId);
  if (!request) return;
  const stillOpen = liveAssignments(tx, request.id, ["proposed", "offered", "accepted"]);
  if (stillOpen.length === 0 && requestStatus(request) === "approved") moveRequest(tx, request, "received");
}

// An accepted pickup leaves a run only when no route reaches it in time or the driver cancels.
export function revokeAccepted(tx: Tx, assignment: Assignment, status: "revoked" | "cancelled", reason: string) {
  setAssignment(tx, assignment, status);
  audit(tx, "revoke", `assignment ${assignment.id} ${status}: ${reason}`);
  const request = tx.db.request.id.find(assignment.requestId);
  if (request && requestStatus(request) !== "closed") moveRequest(tx, request, "reassigning", assignment);
}

// Brings a household's ride request in line with its record: opens one when the household can't
// leave, refreshes its needs, and drops offers the vehicle can no longer serve.
export function syncRequest(tx: Tx, home: Household) {
  const existing = tx.db.request.householdId.find(home.id);
  const needsRide = home.inZone && home.canLeave === false;
  if (!existing) {
    if (!needsRide) return;
    tx.db.request.insert({
      id: 0n,
      householdId: home.id,
      status: "received",
      people: home.people,
      mobility: home.mobility,
      assistance: home.assistance,
      oxygen: home.oxygen,
      deadlineAt: deadlineFor(tx, home),
      escalation: undefined,
      etaMinutes: undefined,
      createdAt: tx.timestamp,
      updatedAt: tx.timestamp,
    });
    audit(tx, "request", `ride request opened for ${home.address}`);
    return;
  }
  if (requestStatus(existing) === "closed") return;
  const request = tx.db.request.id.update({
    ...existing,
    people: home.people,
    mobility: home.mobility,
    assistance: home.assistance,
    oxygen: home.oxygen,
    updatedAt: tx.timestamp,
  });
  const needs = needsOf(request);
  for (const assignment of liveAssignments(tx, request.id, ["proposed", "offered", "accepted"])) {
    const v = tx.db.vehicle.id.find(assignment.vehicleId);
    if (v && vehicleCanServe(v, needs)) continue;
    if (assignment.status === "accepted") revokeAccepted(tx, assignment, "revoked", "needs changed beyond the vehicle");
    else endOpenOffer(tx, assignment, "replaced");
  }
  if (!needsRide && liveAssignments(tx, request.id, ["accepted"]).length === 0) {
    for (const open of liveAssignments(tx, request.id, ["proposed", "offered"])) endOpenOffer(tx, open, "replaced");
    const latest = tx.db.request.id.find(request.id);
    if (latest && requestStatus(latest) !== "closed") moveRequest(tx, latest, "closed");
  }
}

export const runAt = (tx: Tx, seconds: number) => ScheduleAt.time(later(tx, seconds).microsSinceUnixEpoch);

// The status line for a request as it stands, with its accepted driver if it has one.
export function lineFor(tx: Tx, request: Request) {
  const accepted = liveAssignments(tx, request.id, ["accepted"])[0] ?? null;
  return statusLine(requestStatus(request), rideFor(tx, accepted));
}
