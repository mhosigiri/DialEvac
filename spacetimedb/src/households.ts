import { SenderError, t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { audit, hazardAtFor, lineFor, liveAssignments, moveRequest, queueMessage, requestStatus, syncRequest, type Household, type Tx } from "./core";
import { insidePolygon } from "./domain/geo";
import { isAssistance, isMobility } from "./domain/need";
import { ESCALATIONS } from "./domain/status";
import { startReachLadder } from "./reach";
import { SURVEY_ASK } from "./domain/script";

// Households: the rider list, the warning zone, and the record the voice agent and Photon replies
// fill in. Every record change logs a correction and runs syncRequest, so a changed need reaches
// any open offer in the same transaction.

const riderRow = t.object("RiderRow", {
  riderId: t.string(),
  name: t.string(),
  address: t.string(),
  lat: t.f64(),
  lng: t.f64(),
  phone: t.string(),
  language: t.string(),
  mobility: t.string(),
  assistance: t.string(),
  // What records say before anyone is asked: household size, oxygen, and a 0-1 prior that the home
  // needs help (a medical registry, a policy file). They rank who is called first.
  people: t.option(t.u32()),
  oxygen: t.option(t.bool()),
  needProbability: t.option(t.f64()),
});

type Known = Partial<Pick<Household, "people" | "oxygen" | "needProbability">>;

const known = (row: Known): Known =>
  Object.fromEntries(Object.entries({ people: row.people, oxygen: row.oxygen, needProbability: row.needProbability }).filter(([, v]) => v !== undefined));

export const importRiders = spacetimedb.reducer({ riders: t.array(riderRow) }, (ctx, { riders }) => {
  for (const rider of riders) {
    const existing = ctx.db.household.riderId.find(rider.riderId);
    const fields = {
      riderId: rider.riderId,
      name: rider.name,
      address: rider.address,
      lat: rider.lat,
      lng: rider.lng,
      phone: rider.phone,
      language: rider.language,
      ...known(rider),
      mobility: isMobility(rider.mobility) ? rider.mobility : "walks",
      assistance: isAssistance(rider.assistance) ? rider.assistance : "none",
    };
    if (existing) ctx.db.household.id.update({ ...existing, ...fields });
    else insertHousehold(ctx, { ...fields, simulated: false });
  }
  audit(ctx, "riders", `imported ${riders.length} riders`);
});

export function insertHousehold(
  tx: Tx,
  row: Pick<Household, "riderId" | "name" | "address" | "lat" | "lng" | "phone" | "language" | "mobility" | "assistance" | "simulated"> & Known,
) {
  return tx.db.household.insert({
    id: 0n,
    people: 1,
    oxygen: false,
    needProbability: 0,
    ...row,
    inZone: false,
    reach: "idle",
    canLeave: undefined,
    hazardAt: undefined,
  });
}

// `rings` is a GeoJSON Polygon's coordinates: [[[lng, lat], ...], ...holes].
export function applyZone(tx: Tx, rings: [number, number][][]) {
  const started = Boolean(tx.db.control.id.find(0)?.warningAt);
  let entered = 0;
  for (const home of tx.db.household.iter()) {
    const inside = insidePolygon(home, rings);
    if (inside === home.inZone) continue;
    const updated = tx.db.household.id.update({ ...home, inZone: inside, hazardAt: inside ? hazardAtFor(tx, home) : home.hazardAt });
    if (inside) {
      entered += 1;
      if (started) startReachLadder(tx, updated);
    }
    syncRequest(tx, updated);
  }
  return entered;
}

export const setZone = spacetimedb.reducer({ ringsJson: t.string() }, (ctx, { ringsJson }) => {
  const rings = JSON.parse(ringsJson) as [number, number][][];
  if (!Array.isArray(rings) || !Array.isArray(rings[0])) throw new SenderError("expected GeoJSON polygon coordinates");
  const entered = applyZone(ctx, rings);
  audit(ctx, "zone", `warning zone drawn: ${entered} homes entered`);
});

const recordPatch = t.object("RecordPatch", {
  canLeave: t.option(t.bool()),
  people: t.option(t.u32()),
  mobility: t.option(t.string()),
  assistance: t.option(t.string()),
  oxygen: t.option(t.bool()),
});

type RecordPatch = { canLeave?: boolean; people?: number; mobility?: string; assistance?: string; oxygen?: boolean };

export function applyRecord(tx: Tx, home: Household, patch: RecordPatch, source: string) {
  if (patch.mobility !== undefined && !isMobility(patch.mobility)) throw new SenderError(`unknown mobility ${patch.mobility}`);
  if (patch.assistance !== undefined && !isAssistance(patch.assistance)) throw new SenderError(`unknown assistance ${patch.assistance}`);
  const next = { ...home };
  for (const [field, value] of Object.entries(patch) as [keyof RecordPatch, RecordPatch[keyof RecordPatch]][]) {
    if (value === undefined || next[field] === value) continue;
    if (next[field] !== undefined) {
      tx.db.correction.insert({ id: 0n, householdId: home.id, field, before: String(next[field]), after: String(value), source, at: tx.timestamp });
    }
    (next as Record<string, unknown>)[field] = value;
  }
  const updated = tx.db.household.id.update({ ...next, reach: "reached" });
  syncRequest(tx, updated);
  return updated;
}

export const updateRecord = spacetimedb.reducer(
  { householdId: t.u64(), patch: recordPatch, source: t.string() },
  (ctx, { householdId, patch, source }) => {
    const home = ctx.db.household.id.find(householdId);
    if (!home) throw new SenderError("no such household");
    applyRecord(ctx, home, patch, source);
  },
);

export const escalate = spacetimedb.reducer({ householdId: t.u64(), reason: t.string() }, (ctx, { householdId, reason }) => {
  if (!(ESCALATIONS as readonly string[]).includes(reason)) throw new SenderError(`unknown escalation ${reason}`);
  const request = ctx.db.request.householdId.find(householdId);
  if (!request) throw new SenderError("no ride request to escalate");
  if (requestStatus(request) === "closed") throw new SenderError("request is closed");
  ctx.db.request.id.update({ ...request, escalation: reason, updatedAt: ctx.timestamp });
  audit(ctx, "escalation", `household ${householdId}: ${reason}`);
});

// Calls: the voice service claims queued rows, then reports how each went.
export const claimCall = spacetimedb.reducer({ callId: t.u64(), providerId: t.string() }, (ctx, { callId, providerId }) => {
  const c = ctx.db.call.id.find(callId);
  if (!c || c.phase !== "queued") throw new SenderError("changed");
  ctx.db.call.id.update({ ...c, phase: "ringing", providerId });
});

export const callAnswered = spacetimedb.reducer({ callId: t.u64() }, (ctx, { callId }) => {
  const c = ctx.db.call.id.find(callId);
  if (!c || c.phase !== "ringing") throw new SenderError("changed");
  ctx.db.call.id.update({ ...c, phase: "live" });
});

export function endCall(tx: Tx, callId: bigint, outcome: string) {
  const c = tx.db.call.id.find(callId);
  if (!c || c.phase === "ended") return;
  // Picking up is not being reached: the home counts as reached once a record says whether it can leave.
  tx.db.call.id.update({ ...c, phase: "ended", outcome, endedAt: tx.timestamp });
}

export const callEnded = spacetimedb.reducer({ callId: t.u64(), outcome: t.string() }, (ctx, { callId, outcome }) => endCall(ctx, callId, outcome));

export const addTranscriptLine = spacetimedb.reducer(
  { callId: t.u64(), speaker: t.string(), text: t.string() },
  (ctx, { callId, speaker, text }) => {
    const c = ctx.db.call.id.find(callId);
    if (!c) throw new SenderError("no such call");
    const request = ctx.db.request.householdId.find(c.householdId);
    ctx.db.transcriptLine.insert({ id: 0n, callId, speaker, text, requestStatus: request?.status, at: ctx.timestamp });
  },
);

export const markCallback = spacetimedb.reducer({ callbackId: t.u64(), state: t.string() }, (ctx, { callbackId, state }) => {
  if (!["placed", "played", "unanswered"].includes(state)) throw new SenderError(`unknown callback state ${state}`);
  const cb = ctx.db.callback.id.find(callbackId);
  if (!cb) throw new SenderError("no such callback");
  if (state === "placed") {
    const request = ctx.db.request.id.find(cb.requestId);
    if (cb.state !== "pending" || !request || requestStatus(request) === "closed") throw new SenderError("callback changed or request is closed");
  } else if (cb.state === "cancelled") return; // A late provider webhook cannot revive cancelled work.
  ctx.db.callback.id.update({ ...cb, state });
});

// Photon messages: the messaging service claims queued rows and reports delivery.
export const claimMessage = spacetimedb.reducer({ messageId: t.u64() }, (ctx, { messageId }) => {
  const m = ctx.db.message.id.find(messageId);
  if (!m || m.state !== "queued") throw new SenderError("changed");
  ctx.db.message.id.update({ ...m, state: "sending" });
});

export const messageSent = spacetimedb.reducer({ messageId: t.u64(), providerId: t.string() }, (ctx, { messageId, providerId }) => {
  const m = ctx.db.message.id.find(messageId);
  if (m) ctx.db.message.id.update({ ...m, state: "sent", providerId });
});

export const messageFailed = spacetimedb.reducer({ messageId: t.u64(), error: t.string() }, (ctx, { messageId, error }) => {
  const m = ctx.db.message.id.find(messageId);
  if (m) ctx.db.message.id.update({ ...m, state: "failed", error });
});

// Photon's shared line can only answer someone who has texted it, so a text it refuses waits for
// the resident's first message instead of failing.
export const messageWaiting = spacetimedb.reducer({ messageId: t.u64(), error: t.string() }, (ctx, { messageId, error }) => {
  const m = ctx.db.message.id.find(messageId);
  if (m) ctx.db.message.id.update({ ...m, state: "waiting", error });
});

// Once the resident writes, waiting texts go out ahead of the reply, as new rows so they keep their
// order. A status line is dropped since the reply carries the current one, and so is everything
// once the resident has answered with a number. Returns how many went out.
function releaseWaiting(tx: Tx, householdId: bigint, answered: boolean) {
  const waiting = [...tx.db.message.householdId.filter(householdId)].filter((m) => m.direction === "out" && m.state === "waiting");
  let released = 0;
  for (const m of waiting.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const send = !answered && m.requestStatus === undefined;
    tx.db.message.id.update({ ...m, state: "superseded", error: send ? "resent after the resident wrote" : "replaced by the reply" });
    if (send) {
      queueMessage(tx, householdId, m.body);
      released += 1;
    }
  }
  return released;
}

// A resident's reply over Photon. Numbered answers fill the record; anything else is kept for a
// human and answered with the request's current status line, never a free-text promise.
const REPLIES: Record<string, RecordPatch> = {
  "1": { canLeave: true },
  "2": { canLeave: false, mobility: "walks", assistance: "none" },
  "3": { canLeave: false, mobility: "wheelchair", assistance: "one_person" },
  "4": { canLeave: false, mobility: "bedbound", assistance: "two_person_lift" },
};


export function handleReply(tx: Tx, phone: string, body: string, providerId: string) {
  const home = [...tx.db.household.phone.filter(phone)][0];
  if (!home) {
    audit(tx, "message", `reply from an unknown number ending ${phone.slice(-4)}`);
    return;
  }
  // The messaging service polls Photon with overlapping windows, so the same reply can arrive twice.
  if ([...tx.db.message.householdId.filter(home.id)].some((m) => m.direction === "in" && m.providerId === providerId)) return;
  tx.db.message.insert({
    id: 0n,
    householdId: home.id,
    direction: "in",
    state: "received",
    body,
    requestStatus: undefined,
    providerId,
    error: undefined,
    at: tx.timestamp,
  });
  const patch = REPLIES[body.trim()];
  const released = releaseWaiting(tx, home.id, patch !== undefined);
  const updated = patch ? applyRecord(tx, home, patch, "photon") : home;
  const request = tx.db.request.householdId.find(updated.id);
  if (request) queueMessage(tx, home.id, lineFor(tx, request), requestStatus(request));
  else if (!patch) {
    if (released === 0) queueMessage(tx, home.id, SURVEY_ASK);
  }
  else queueMessage(tx, home.id, "Thank you. Leave now if you can do it safely.");
}

// A keypad answer on a survey call, the same choices as a Photon reply.
export function handleDigit(tx: Tx, callId: bigint, digit: string) {
  const c = tx.db.call.id.find(callId);
  const home = c && tx.db.household.id.find(c.householdId);
  if (!c || !home) throw new SenderError("no such call");
  const patch = REPLIES[digit];
  if (patch) applyRecord(tx, home, patch, "keypad");
  return Boolean(patch);
}

export const recordDigit = spacetimedb.reducer({ callId: t.u64(), digit: t.string() }, (ctx, { callId, digit }) => {
  if (handleDigit(ctx, callId, digit)) endCall(ctx, callId, "answered");
});

// A resident who called the response line. The call is logged against the home with the caller's
// number, and a clear answer fills the record like a pressed key. A conversation already logged is
// skipped, so a retried webhook changes nothing.
export function handleInboundCall(tx: Tx, phone: string, providerId: string, answer: { choice: string; people?: number; oxygen?: boolean }) {
  const home = [...tx.db.household.phone.filter(phone)][0];
  if (!home) {
    audit(tx, "call", `call from an unknown number ending ${phone.slice(-4)}`);
    return undefined;
  }
  const logged = [...tx.db.call.householdId.filter(home.id)].find((c) => c.providerId === providerId);
  if (logged) return logged;
  const call = tx.db.call.insert({ id: 0n, householdId: home.id, purpose: "inbound", phase: "live", attempt: 0, priority: 0, outcome: undefined, providerId, queuedAt: tx.timestamp, endedAt: undefined });
  const patch = REPLIES[answer.choice];
  if (patch) applyRecord(tx, home, { ...patch, people: answer.people, oxygen: answer.oxygen }, "voice");
  endCall(tx, call.id, "answered");
  return call;
}

export const inboundCallEnded = spacetimedb.reducer(
  { phone: t.string(), providerId: t.string(), choice: t.string(), people: t.option(t.u32()), oxygen: t.option(t.bool()) },
  (ctx, { phone, providerId, choice, people, oxygen }) => void handleInboundCall(ctx, phone, providerId, { choice, people, oxygen }),
);

export const receiveMessage = spacetimedb.reducer(
  { phone: t.string(), body: t.string(), providerId: t.string() },
  (ctx, { phone, body, providerId }) => handleReply(ctx, phone, body, providerId),
);

export const closeRequest = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  const request = ctx.db.request.id.find(requestId);
  if (!request) throw new SenderError("no such request");
  // Also repair legacy closed rows whose assignments were never released. No callback announces closure.
  for (const a of liveAssignments(ctx, requestId, ["proposed", "offered", "accepted"])) {
    ctx.db.assignment.id.update({ ...a, status: a.status === "accepted" ? "completed" : "replaced", decidedAt: ctx.timestamp });
  }
  for (const cb of ctx.db.callback.requestId.filter(requestId)) {
    if (cb.state === "pending") ctx.db.callback.id.update({ ...cb, state: "cancelled" });
  }
  for (const message of ctx.db.message.householdId.filter(request.householdId)) {
    if (message.direction === "out" && message.requestStatus !== undefined && ["queued", "waiting"].includes(message.state)) {
      ctx.db.message.id.update({ ...message, state: "superseded", error: "request closed" });
    }
  }
  if (requestStatus(request) !== "closed") moveRequest(ctx, request, "closed", null, { etaMinutes: undefined });
  else if (request.etaMinutes !== undefined) ctx.db.request.id.update({ ...request, etaMinutes: undefined, updatedAt: ctx.timestamp });
});
