import { SenderError, t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { requireOperator, requireService } from "./authorization";
import { lineFor, liveAssignments, queueMessage } from "./core";

export const notifyResident = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  requireOperator(ctx);
  const request = ctx.db.request.id.find(requestId);
  const accepted = liveAssignments(ctx, requestId, ["accepted"])[0];
  if (!request || !["driver_accepted", "en_route"].includes(request.status) || !accepted) throw new SenderError("An active accepted assignment is required before notifying the resident");
  const key = `${requestId}:${accepted.id}`;
  if (ctx.db.residentNotice.key.find(key)) return;
  // Acceptance already queues the honest update. A dispatcher click reuses that delivery row.
  const callback = ctx.db.callback.key.find(`${requestId}:${accepted.id}:driver_accepted`);
  let message = callback && [...ctx.db.message.householdId.filter(request.householdId)]
    .find(m => m.direction === "out" && m.requestStatus === "driver_accepted" && m.body === callback.line && m.at.microsSinceUnixEpoch === callback.at.microsSinceUnixEpoch);
  if (!message) {
    const before = new Set([...ctx.db.message.householdId.filter(request.householdId)].map(m => m.id));
    queueMessage(ctx, request.householdId, lineFor(ctx, request), request.status as "driver_accepted" | "en_route");
    message = [...ctx.db.message.householdId.filter(request.householdId)].find(m => !before.has(m.id));
  }
  if (!message) throw new SenderError("notification was not queued");
  ctx.db.residentNotice.insert({ key, requestId, assignmentId: accepted.id, messageId: message.id, at: ctx.timestamp });
});

const HANDOFF_MOVES: Record<string, readonly string[]> = {
  requested: ["ringing", "connected", "failed"], ringing: ["connected", "failed"], connected: [], failed: [],
};
const containsPhone = (value: string) => /\+?\d[\d ()-]{6,}\d/.test(value);
export const reportCallHandoff = spacetimedb.reducer({ callId: t.u64(), status: t.string(), targetLabel: t.string(), failureReason: t.option(t.string()), detail: t.option(t.string()) },
  (ctx, { callId, status, targetLabel, failureReason, detail }) => {
    requireService(ctx);
    const call = ctx.db.call.id.find(callId);
    if (!call) throw new SenderError("no such call");
    if (!Object.hasOwn(HANDOFF_MOVES, status)) throw new SenderError("unknown handoff status");
    if (!targetLabel.trim() || targetLabel.length > 120 || containsPhone(targetLabel) ||
      [failureReason, detail].some(value => value !== undefined && (value.length > 300 || containsPhone(value)))) throw new SenderError("handoff display fields must not contain a full phone number");
    const existing = ctx.db.callHandoff.callId.find(callId);
    if (!existing) {
      if (!["requested", "failed"].includes(status) || (status === "requested" && !["ringing", "live"].includes(call.phase))) throw new SenderError("handoff requires an active call and requested status");
      ctx.db.callHandoff.insert({ callId, status, targetLabel, failureReason: status === "failed" ? failureReason || "Transfer failed" : undefined, detail, requestedAt: ctx.timestamp, updatedAt: ctx.timestamp });
    } else {
      if (targetLabel !== existing.targetLabel) throw new SenderError("handoff changed");
      if (["connected", "failed"].includes(existing.status) && status !== existing.status) return; // Late/retried provider events never regress a terminal state.
      if (status !== existing.status && !HANDOFF_MOVES[existing.status].includes(status)) return;
      ctx.db.callHandoff.callId.update({ ...existing, status, failureReason: status === "failed" ? failureReason || "Transfer failed" : undefined, detail, updatedAt: ctx.timestamp });
    }
  });
