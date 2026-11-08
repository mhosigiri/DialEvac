import { SenderError, t } from "spacetimedb/server";
import { Timestamp } from "spacetimedb";
import { spacetimedb, providerTranscriptTurn } from "./schema";
import { requireOperator, requireService } from "./authorization";
import { later } from "./core";
import { recordCallTranscript } from "./transcripts";
import { parseCallAnalysis } from "../../shared/call-analysis";

export const recordProviderCall = spacetimedb.reducer({
  providerId: t.string(), agentId: t.string(), callId: t.option(t.u64()), callbackId: t.option(t.u64()), householdId: t.option(t.u64()),
  direction: t.string(), status: t.string(), callerLabel: t.string(), startedAt: t.option(t.timestamp()), durationSeconds: t.option(t.f64()), turns: t.array(providerTranscriptTurn),
}, (ctx, args) => {
  requireService(ctx);
  const { providerId, agentId, direction, status, callerLabel, startedAt, durationSeconds, turns } = args;
  if (!providerId.trim() || providerId.length > 256 || !agentId.trim() || agentId.length > 256 || !["inbound", "outbound", "unknown"].includes(direction) ||
    !["processing", "done", "failed"].includes(status) || !/^(Unknown caller|Caller ending \d{4}|Outbound call)$/.test(callerLabel) ||
    (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) || turns.length > 2000 ||
    turns.some(turn => !["agent", "resident"].includes(turn.speaker) || !turn.text.trim() || turn.text.length > 20_000) || JSON.stringify(turns).length > 1_000_000) throw new SenderError("Invalid provider call");
  const existing = ctx.db.callRecord.providerId.find(providerId);
  if (existing && existing.agentId !== agentId) throw new SenderError("Conversation agent changed");
  // Once finalized, partial/stale provider events cannot erase the durable transcript or analysis.
  if (existing && existing.status !== "processing") return;
  let call = args.callId !== undefined ? ctx.db.call.id.find(args.callId) : null;
  const callback = args.callbackId !== undefined ? ctx.db.callback.id.find(args.callbackId) : null;
  // Old provider calls can reference retired jobs. Retain their independent provider record.
  let householdId = call?.householdId ?? callback?.householdId ?? args.householdId;
  const endedAt = status === "processing" ? undefined : startedAt && durationSeconds !== undefined
    ? new Timestamp(startedAt.microsSinceUnixEpoch + BigInt(Math.round(durationSeconds * 1_000_000))) : ctx.timestamp;
  if (args.householdId !== undefined && householdId !== args.householdId) throw new SenderError("Household link changed");
  if (householdId !== undefined && !ctx.db.household.id.find(householdId)) throw new SenderError("Unknown household");
  if (!call && householdId !== undefined) call = [...ctx.db.call.householdId.filter(householdId)].find(c => c.providerId === providerId) ?? null;
  if (call?.providerId && !["elevenlabs", providerId].includes(call.providerId)) throw new SenderError("Conversation is linked to another call");
  if (!call && householdId !== undefined) call = ctx.db.call.insert({ id: 0n, householdId, purpose: callback ? "callback" : direction === "inbound" ? "inbound" : "provider",
    phase: status === "processing" ? "live" : "ended", attempt: 1, priority: 0, outcome: status === "processing" ? undefined : status === "failed" ? "failed" : "answered",
    providerId, queuedAt: startedAt ?? ctx.timestamp, endedAt });
  if (call) {
    householdId = call.householdId;
    ctx.db.call.id.update({ ...call, providerId, phase: status === "processing" ? "live" : "ended", outcome: status === "processing" ? undefined : status === "failed" ? "failed" : "answered",
      endedAt });
    if (status !== "processing" && turns.length) recordCallTranscript(ctx, { providerId, callId: call.id, callbackId: undefined, phone: undefined, turns });
  }
  const revision = existing ? existing.revision + (JSON.stringify(existing.turns) !== JSON.stringify(turns) ? 1n : 0n) : 1n;
  const row = { providerId, agentId, callId: call?.id, householdId, direction, status, callerLabel, startedAt, durationSeconds, turns, revision,
    recordedAt: existing?.recordedAt ?? ctx.timestamp, updatedAt: ctx.timestamp };
  if (existing) ctx.db.callRecord.providerId.update(row); else ctx.db.callRecord.insert(row);
  if (status !== "processing") {
    const analysis = { providerId, revision, state: turns.length ? "pending" : "no_transcript", resultJson: undefined, model: undefined, error: undefined, attempts: 0,
      claimToken: undefined, leaseUntil: undefined, nextAttemptAt: ctx.timestamp, updatedAt: ctx.timestamp };
    if (ctx.db.callAnalysis.providerId.find(providerId)) ctx.db.callAnalysis.providerId.update(analysis); else ctx.db.callAnalysis.insert(analysis);
  }
});

export const claimCallAnalysis = spacetimedb.reducer({ providerId: t.string(), revision: t.u64(), claimToken: t.string() }, (ctx, args) => {
  requireService(ctx);
  const row = ctx.db.callAnalysis.providerId.find(args.providerId);
  if (!row || row.revision !== args.revision || !["pending", "failed", "analyzing"].includes(row.state) ||
    row.nextAttemptAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch ||
    row.leaseUntil && row.leaseUntil.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch) throw new SenderError("Analysis already claimed or not due");
  if (!args.claimToken || args.claimToken.length > 100) throw new SenderError("Invalid analysis claim");
  ctx.db.callAnalysis.providerId.update({ ...row, state: "analyzing", attempts: row.attempts + 1, claimToken: args.claimToken, leaseUntil: later(ctx, 120), updatedAt: ctx.timestamp });
});

export const finishCallAnalysis = spacetimedb.reducer({ providerId: t.string(), revision: t.u64(), claimToken: t.string(), model: t.string(), resultJson: t.option(t.string()), error: t.option(t.string()) }, (ctx, args) => {
  requireService(ctx);
  const row = ctx.db.callAnalysis.providerId.find(args.providerId), call = ctx.db.callRecord.providerId.find(args.providerId);
  if (!row || !call || row.state !== "analyzing" || row.revision !== args.revision || call.revision !== args.revision || row.claimToken !== args.claimToken) return;
  if (args.model.length > 200 || args.error && args.error.length > 300 || Boolean(args.resultJson) === Boolean(args.error)) throw new SenderError("Invalid analysis result");
  let resultJson: string | undefined;
  if (args.resultJson) {
    if (args.resultJson.length > 50_000) throw new SenderError("Analysis too large");
    try { resultJson = JSON.stringify(parseCallAnalysis(JSON.parse(args.resultJson), call.turns)); } catch { throw new SenderError("Analysis evidence is invalid"); }
  }
  ctx.db.callAnalysis.providerId.update({ ...row, state: resultJson ? "ready" : "failed", resultJson, model: args.model, error: args.error,
    claimToken: undefined, leaseUntil: undefined, nextAttemptAt: later(ctx, Math.min(900, 30 * 2 ** Math.min(row.attempts, 5))), updatedAt: ctx.timestamp });
});

export const retryCallAnalysis = spacetimedb.reducer({ providerId: t.string() }, (ctx, { providerId }) => {
  requireOperator(ctx);
  const row = ctx.db.callAnalysis.providerId.find(providerId);
  if (!row || row.state !== "failed") throw new SenderError("Only failed analysis can be retried");
  ctx.db.callAnalysis.providerId.update({ ...row, state: "pending", claimToken: undefined, leaseUntil: undefined, nextAttemptAt: ctx.timestamp, updatedAt: ctx.timestamp });
});
