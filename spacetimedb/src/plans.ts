import { SenderError, t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { audit, control, endOpenOffer, runAt, liveAssignments, moveRequest, needsOf, OFFER_SECONDS, requestStatus, revokeAccepted, setAssignment, type Tx } from "./core";
import { vehicleCanServe } from "./domain/need";
import { OPEN_OFFER } from "./domain/status";
import { requireOperator } from "./authorization";

// Every dispatcher, stand-in or real, writes through writePlan, so the contract's rules hold for
// all of them: offers only to vehicles that can serve the rider, never into an accepted run, one
// live offer per request, revocations only of accepted pickups.

export type PlannedOffer = { requestId: bigint; vehicleId: bigint; shelterId?: bigint; etaMinutes: number; stopOrder: number };
export type PlanWrite = {
  solver: string;
  solveMs: number;
  fallbackReason?: string;
  offers: PlannedOffer[];
  replace: bigint[];
  revoke: { assignmentId: bigint; reason: string }[];
  escalate: bigint[];
};

function lastAcceptedStop(tx: Tx, vehicleId: bigint) {
  let last = -1;
  for (const a of tx.db.assignment.vehicleId.filter(vehicleId)) {
    if (a.status === "accepted") last = Math.max(last, a.stopOrder);
  }
  return last;
}

export function writePlan(tx: Tx, write: PlanWrite) {
  const planRow = tx.db.plan.insert({
    id: 0n,
    solver: write.solver,
    solveMs: Math.round(write.solveMs),
    requestCount: write.offers.length,
    vehicleCount: new Set(write.offers.map((o) => o.vehicleId)).size,
    fallbackReason: write.fallbackReason,
    at: tx.timestamp,
  });

  for (const { assignmentId, reason } of write.revoke) {
    const a = tx.db.assignment.id.find(assignmentId);
    if (a?.status === "accepted") revokeAccepted(tx, a, "revoked", reason);
  }
  for (const id of write.replace) {
    const a = tx.db.assignment.id.find(id);
    if (a && OPEN_OFFER.includes(a.status as never)) endOpenOffer(tx, a, "replaced");
  }
  for (const offer of write.offers) {
    const request = tx.db.request.id.find(offer.requestId);
    const vehicle = tx.db.vehicle.id.find(offer.vehicleId);
    if (!request || !vehicle) throw new SenderError(`plan names a missing request or vehicle`);
    if (requestStatus(request) === "closed") throw new SenderError(`request ${request.id} is closed`);
    if (!vehicleCanServe(vehicle, needsOf(request))) {
      throw new SenderError(`vehicle ${vehicle.name} can't serve request ${request.id}`);
    }
    if (liveAssignments(tx, request.id, ["proposed", "offered", "accepted"]).length > 0) {
      throw new SenderError(`request ${request.id} already has a live offer`);
    }
    if (offer.stopOrder <= lastAcceptedStop(tx, vehicle.id)) {
      throw new SenderError(`offer to ${vehicle.name} would land inside its accepted run`);
    }
    const assignment = tx.db.assignment.insert({
      id: 0n,
      requestId: request.id,
      vehicleId: vehicle.id,
      shelterId: offer.shelterId,
      planId: planRow.id,
      status: "proposed",
      stopOrder: offer.stopOrder,
      etaMinutes: Math.max(1, Math.ceil(offer.etaMinutes)),
      offeredAt: undefined,
      decidedAt: undefined,
    });
    if (control(tx).autoApprove) approve(tx, assignment.id);
  }
  for (const householdId of write.escalate) {
    const request = tx.db.request.householdId.find(householdId);
    if (request && !request.escalation) tx.db.request.id.update({ ...request, escalation: "unservable", updatedAt: tx.timestamp });
  }
  audit(tx, "plan", `plan ${planRow.id} by ${write.solver}: ${write.offers.length} offers, ${write.replace.length} replaced, ${write.revoke.length} revoked`);
  return planRow;
}

// Approval is internal: the driver sees the offer, the rider hears nothing yet.
export function approve(tx: Tx, assignmentId: bigint) {
  const a = tx.db.assignment.id.find(assignmentId);
  if (!a || a.status !== "proposed") throw new SenderError("changed");
  const request = tx.db.request.id.find(a.requestId);
  if (!request || requestStatus(request) === "closed") throw new SenderError("request is closed or changed");
  setAssignment(tx, a, "offered");
  tx.db.assignment.id.update({ ...tx.db.assignment.id.find(assignmentId)!, offeredAt: tx.timestamp });
  if (request && requestStatus(request) === "received") moveRequest(tx, request, "approved");
  tx.db.offerExpiry.insert({ scheduledId: 0n, scheduledAt: runAt(tx, OFFER_SECONDS), assignmentId });
}

const offerArg = t.object("PlannedOffer", {
  requestId: t.u64(),
  vehicleId: t.u64(),
  shelterId: t.option(t.u64()),
  etaMinutes: t.f64(),
  stopOrder: t.u32(),
});

export const proposePlan = spacetimedb.reducer(
  {
    solver: t.string(),
    offers: t.array(offerArg),
    replace: t.array(t.u64()),
    revoke: t.array(t.object("PlannedRevoke", { assignmentId: t.u64(), reason: t.string() })),
  },
  (ctx, { solver, offers, replace, revoke }) => {
    requireOperator(ctx);
    writePlan(ctx, { solver, solveMs: 0, offers, replace, revoke, escalate: [] });
  },
);
