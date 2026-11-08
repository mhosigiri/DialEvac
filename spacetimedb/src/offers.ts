import { SenderError, t } from "spacetimedb/server";
import { offerExpiry, spacetimedb } from "./schema";
import { endOpenOffer, liveAssignments, moveRequest, requestStatus, revokeAccepted, setAssignment, type Tx } from "./core";
import { approve } from "./plans";
import { requireInternal, requireOperator } from "./authorization";

// The driver's side. Accept is version-checked inside the transaction: unless the offer is still
// open, it fails with "changed" and nothing is written, so a stale tap never reaches the rider.

export function accept(tx: Tx, assignmentId: bigint) {
  const a = tx.db.assignment.id.find(assignmentId);
  if (!a || a.status !== "offered") throw new SenderError("changed");
  const request = tx.db.request.id.find(a.requestId);
  if (!request || requestStatus(request) === "closed") throw new SenderError("changed");
  const accepted = setAssignment(tx, a, "accepted");
  for (const other of liveAssignments(tx, request.id, ["proposed", "offered"])) setAssignment(tx, other, "replaced");
  moveRequest(tx, request, "driver_accepted", accepted, { etaMinutes: accepted.etaMinutes, escalation: undefined });
}

export const approveOffer = spacetimedb.reducer({ assignmentId: t.u64() }, (ctx, { assignmentId }) => {
  requireOperator(ctx);
  approve(ctx, assignmentId);
});

export const acceptOffer = spacetimedb.reducer({ assignmentId: t.u64() }, (ctx, { assignmentId }) => {
  requireOperator(ctx);
  accept(ctx, assignmentId);
});

export const declineOffer = spacetimedb.reducer({ assignmentId: t.u64() }, (ctx, { assignmentId }) => {
  requireOperator(ctx);
  const a = ctx.db.assignment.id.find(assignmentId);
  if (!a || a.status !== "offered") throw new SenderError("changed");
  const request = ctx.db.request.id.find(a.requestId);
  if (!request || requestStatus(request) === "closed") throw new SenderError("request is closed or changed");
  endOpenOffer(ctx, a, "declined");
});

export const cancelByDriver = spacetimedb.reducer({ assignmentId: t.u64(), reason: t.string() }, (ctx, { assignmentId, reason }) => {
  requireOperator(ctx);
  const a = ctx.db.assignment.id.find(assignmentId);
  if (!a || a.status !== "accepted") throw new SenderError("changed");
  const request = ctx.db.request.id.find(a.requestId);
  if (!request || requestStatus(request) === "closed") throw new SenderError("request is closed or changed");
  revokeAccepted(ctx, a, "cancelled", reason || "driver can't make this pickup");
});

export const expireOffer = spacetimedb.reducer(
  { onSchedule: offerExpiry },
  { timer: offerExpiry.rowType },
  (ctx, { timer }) => {
    requireInternal(ctx);
    const a = ctx.db.assignment.id.find(timer.assignmentId);
    if (a && (a.status === "offered" || a.status === "proposed")) endOpenOffer(ctx, a, "expired");
  },
);
