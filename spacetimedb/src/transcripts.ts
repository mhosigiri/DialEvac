import { SenderError, t } from "spacetimedb/server";
import { Timestamp } from "spacetimedb";
import { spacetimedb } from "./schema";
import { audit } from "./core";
import { requireService } from "./authorization";

const transcriptTurn = t.object("TranscriptTurn", { speaker: t.string(), text: t.string() });

// Keep existing call/line tables and reducer signatures intact. The service sends the final
// conversation once; this receipt and all turns share the same transaction, including on retries.
export const recordCallTranscript = spacetimedb.reducer({
  providerId: t.string(), callId: t.option(t.u64()), callbackId: t.option(t.u64()), phone: t.option(t.string()), turns: t.array(transcriptTurn),
}, (ctx, { providerId, callId, callbackId, phone, turns }) => {
  requireService(ctx);
  if (!providerId.trim()) throw new SenderError("conversation id is required");
  if ([callId !== undefined, callbackId !== undefined, phone !== undefined].filter(Boolean).length !== 1) throw new SenderError("supply exactly one call, callback or inbound phone link");
  if (turns.length > 2000) throw new SenderError("too many transcript turns");
  for (const turn of turns) {
    if (!["agent", "resident"].includes(turn.speaker)) throw new SenderError("speaker must be agent or resident");
    if (!turn.text.trim() || turn.text.length > 20_000) throw new SenderError("invalid transcript text");
  }
  if (!turns.length) return;

  const callback = callbackId !== undefined ? ctx.db.callback.id.find(callbackId) : undefined;
  const home = phone !== undefined ? [...ctx.db.household.phone.filter(phone)][0] : undefined;
  if (callbackId !== undefined && !callback) throw new SenderError("no such callback");
  if (phone !== undefined && !home) { audit(ctx, "transcript", "unknown inbound caller; transcript not retained"); return; }
  const householdId = callback?.householdId ?? home?.id;
  let call = callId !== undefined ? ctx.db.call.id.find(callId) : householdId !== undefined
    ? [...ctx.db.call.householdId.filter(householdId)].find(c => c.providerId === providerId) : undefined;
  const receipt = ctx.db.transcriptReceipt.providerId.find(providerId);
  if (receipt) {
    if (call?.id !== receipt.callId) throw new SenderError("conversation is already linked to another call");
    return;
  }
  if (!call && callback) call = ctx.db.call.insert({ id: 0n, householdId: callback.householdId, purpose: "callback", phase: "ended", attempt: 1,
    priority: 0, outcome: "answered", providerId, queuedAt: ctx.timestamp, endedAt: ctx.timestamp });
  if (!call) throw new SenderError("call must be recorded before its transcript");
  if (phone !== undefined && call.purpose !== "inbound") throw new SenderError("conversation is not an inbound call");
  if (callback && call.purpose !== "callback") throw new SenderError("conversation is not a callback");
  if (call.providerId && call.providerId !== "elevenlabs" && call.providerId !== providerId) throw new SenderError("call is already linked to another conversation");
  const request = ctx.db.request.householdId.find(call.householdId);
  ctx.db.call.id.update({ ...call, providerId });
  // Retain array order using distinct ingestion timestamps; IDs are not a sequence contract.
  turns.forEach(({ speaker, text }, i) => ctx.db.transcriptLine.insert({ id: 0n, callId: call!.id, speaker, text, requestStatus: request?.status,
    at: new Timestamp(ctx.timestamp.microsSinceUnixEpoch - BigInt(turns.length - 1 - i)) }));
  ctx.db.transcriptReceipt.insert({ providerId, callId: call.id, turnCount: turns.length, at: ctx.timestamp });
});
