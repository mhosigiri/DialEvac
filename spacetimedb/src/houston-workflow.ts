import { SenderError, t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { requireDemoDatabase } from "./demo-guard";
import { requireOperator } from "./authorization";
import { applyRecord, endCall, insertHousehold } from "./households";
import { seedHoustonVoiceStory } from "./houston-demo";
import { later, liveAssignments, needsOf, type Tx } from "./core";
import { sweepCoverage } from "./reach";
import { insidePolygon, metersBetween } from "./domain/geo";
import { vehicleCanServe } from "./domain/need";
import { writePlan } from "./plans";
import { requestDispatchRoute } from "./routes";

export const HOUSTON_SCENARIOS = [
  { hazard: "hurricane", lat: 29.7617, lng: -95.3983, name: "Buffalo Bayou hurricane", mobility: "walks", assistance: "none", oxygen: true },
  { hazard: "flood", lat: 29.745, lng: -95.36, name: "Houston flood", mobility: "wheelchair", assistance: "one_person", oxygen: false },
  { hazard: "wildfire", lat: 29.785, lng: -95.43, name: "Houston fire", mobility: "bedbound", assistance: "two_person_lift", oxygen: false },
] as const;

function scenario(hazard: string) {
  const s = HOUSTON_SCENARIOS.find(s => s.hazard === hazard);
  if (!s) throw new SenderError("Choose hurricane, flood or wildfire (fire in the CLI)");
  return s;
}
function snapshot(home: { canLeave?: boolean; people: number; mobility: string; oxygen: boolean }) {
  return JSON.stringify({ canLeave: home.canLeave ?? null, people: home.people, mobility: home.mobility, oxygen: home.oxygen });
}

// Explicit operator + isolated-demo gates, synthetic numbers only. No heartbeat or external worker
// is started: the CLI advances each stage through deterministic database transactions.
export function seedHoustonCatalogue(ctx: Tx) {
  seedHoustonVoiceStory(ctx, "hurricane");
  const legacy = ctx.db.zone.externalId.find("demo-houston-catastrophe");
  if (legacy) ctx.db.zone.id.update({ ...legacy, active: false });
  for (const s of HOUSTON_SCENARIOS) {
    const rings: [number, number][][] = [[[s.lng - .012, s.lat - .007], [s.lng + .012, s.lat - .007], [s.lng + .012, s.lat + .007], [s.lng - .012, s.lat + .007], [s.lng - .012, s.lat - .007]]];
    const existing = ctx.db.zone.externalId.find(`demo-houston-${s.hazard}`);
    const fields = { source: "simulated-houston", name: s.name, event: s.hazard, severity: "Simulated", rings: JSON.stringify(rings), active: true,
      at: existing?.at ?? ctx.timestamp, headline: `Synthetic ${s.hazard} exercise; no real outreach`, issuedAt: existing?.issuedAt ?? ctx.timestamp, expiresAt: later(ctx, 3600),
      url: undefined, messageType: undefined, kind: "demo", geometryJson: JSON.stringify({ type: "Polygon", coordinates: rings }), area: "TX" };
    const zone = existing ? ctx.db.zone.id.update({ ...existing, ...fields }) : ctx.db.zone.insert({ id: 0n, externalId: `demo-houston-${s.hazard}`, ...fields });
    let home = ctx.db.household.riderId.find(`demo-houston-catalogue-${s.hazard}`);
    if (!home) {
      home = insertHousehold(ctx, { riderId: `demo-houston-catalogue-${s.hazard}`, name: `Simulated ${s.hazard} household`,
        address: `Synthetic ${s.name} address, Houston, TX`, lat: s.lat, lng: s.lng, phone: `+1713555010${HOUSTON_SCENARIOS.indexOf(s) + 1}`,
        language: "en", mobility: s.mobility, assistance: s.assistance, people: 2, oxygen: s.oxygen, simulated: true });
      home = ctx.db.household.id.update({ ...home, inZone: true, reach: "door_check", hazardAt: later(ctx, 45 * 60) });
    } else if (!home.inZone || home.mobility !== s.mobility || home.assistance !== s.assistance || home.oxygen !== s.oxygen) {
      // Upgrade only these fixed synthetic catalogue records; never rewrite the reserved live
      // profile or historical run snapshots. Corrections document changed fixture needs.
      const reach = home.reach;
      if (!home.inZone) home = ctx.db.household.id.update({ ...home, inZone: true });
      home = applyRecord(ctx, home, { mobility: s.mobility, assistance: s.assistance, oxygen: s.oxygen }, "simulated-fixture-needs");
      home = ctx.db.household.id.update({ ...home, inZone: true, reach });
    }
    const c = ctx.db.catastropheCase.householdId.find(home.id);
    if (!c) ctx.db.catastropheCase.insert({ householdId: home.id, zoneId: zone.id, hazard: s.hazard, runId: "catalogue", callId: undefined, duringSnapshotJson: undefined, simulated: true, updatedAt: ctx.timestamp });
    const live = ctx.db.household.riderId.find("demo-houston-anish");
    if (s.hazard === "hurricane" && live && !ctx.db.catastropheCase.householdId.find(live.id)) ctx.db.catastropheCase.insert({ householdId: live.id, zoneId: zone.id,
      hazard: s.hazard, runId: "live-prepared", callId: undefined, duringSnapshotJson: undefined, simulated: true, updatedAt: ctx.timestamp });
  }
  if (![...ctx.db.vehicle.iter()].some(v => v.name === "Houston demo medical unit")) ctx.db.vehicle.insert({ id: 0n,
    name: "Houston demo medical unit", driverName: "Demo medical dispatcher", kind: "ambulance", seats: 2, wheelchairSpaces: 0,
    stretcherSpaces: 1, crew: 2, lift: true, lat: 29.771, lng: -95.406, simulated: true });
  sweepCoverage(ctx);
}

export const prepareHoustonDemo = spacetimedb.reducer(ctx => {
  requireOperator(ctx); requireDemoDatabase(ctx); seedHoustonCatalogue(ctx);
});

export const simulateCatastrophe = spacetimedb.reducer({ hazard: t.string(), runId: t.string() }, (ctx, { hazard, runId }) => {
  requireOperator(ctx); requireDemoDatabase(ctx);
  const s = scenario(hazard);
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new SenderError("runId must contain 1–64 letters, digits or hyphens");
  seedHoustonCatalogue(ctx);
  const riderId = `demo-houston-run-${runId}`;
  const prior = ctx.db.household.riderId.find(riderId);
  if (prior) {
    if (ctx.db.catastropheCase.householdId.find(prior.id)?.hazard !== hazard) throw new SenderError("runId already belongs to another hazard");
    return; // Retried CLI starts never reset answers, calls or closed requests.
  }
  const zone = ctx.db.zone.externalId.find(`demo-houston-${hazard}`)!;
  ctx.db.zone.id.update({ ...zone, at: ctx.timestamp, issuedAt: ctx.timestamp });
  const home = insertHousehold(ctx, { riderId, name: `Simulated ${hazard} resident (${runId})`, address: `Synthetic ${s.name} home, Houston, TX`,
    lat: s.lat + .001, lng: s.lng + .001, phone: "+17135550199", language: "en", mobility: s.mobility,
    assistance: s.assistance, people: 2, oxygen: s.oxygen, simulated: true });
  ctx.db.household.id.update({ ...home, inZone: true, hazardAt: later(ctx, 45 * 60) });
  ctx.db.catastropheCase.insert({ householdId: home.id, zoneId: zone.id, hazard, runId, callId: undefined, duringSnapshotJson: undefined, simulated: true, updatedAt: ctx.timestamp });
  const rings = JSON.parse(zone.rings) as [number, number][][];
  for (const resident of ctx.db.household.iter()) {
    // The one prepared real-call alias belongs exclusively to Anish's gated live command.
    if (resident.riderId === "demo-houston-anish") continue;
    if (!insidePolygon(resident, rings) || ctx.db.request.householdId.find(resident.id)?.status === "closed") continue;
    if (!/^\+1\d{3}555\d{4}$/.test(resident.phone)) throw new SenderError("Simulation calls require fictional 555 aliases");
    const member = ctx.db.catastropheCase.householdId.find(resident.id) ?? ctx.db.catastropheCase.insert({ householdId: resident.id, zoneId: zone.id,
      hazard, runId, callId: undefined, duringSnapshotJson: undefined, simulated: true, updatedAt: ctx.timestamp });
    if (member.duringSnapshotJson) continue;
    const previous = [...ctx.db.call.householdId.filter(resident.id)].find(c => c.purpose === "survey" && c.phase !== "ended");
    if (previous && previous.phase !== "queued") continue;
    const call = previous ?? ctx.db.call.insert({ id: 0n, householdId: resident.id, purpose: "survey", phase: "queued", attempt: 1, priority: 1,
      outcome: undefined, providerId: "simulated-demo", queuedAt: ctx.timestamp, endedAt: undefined });
    ctx.db.household.id.update({ ...resident, inZone: true, reach: "calling" });
    ctx.db.catastropheCase.householdId.update({ ...member, zoneId: zone.id, hazard, callId: call.id, updatedAt: ctx.timestamp });
  }
  sweepCoverage(ctx);
});

export const simulateAssessment = spacetimedb.reducer({ householdId: t.u64() }, (ctx, { householdId }) => {
  requireOperator(ctx); requireDemoDatabase(ctx);
  const c = ctx.db.catastropheCase.householdId.find(householdId), home = ctx.db.household.id.find(householdId);
  if (!c || !home || c.runId === "live-prepared" || !c.callId) throw new SenderError("A queued simulated scenario call is required");
  if (c.duringSnapshotJson) return;
  const call = ctx.db.call.id.find(c.callId);
  if (!call || call.phase !== "queued") throw new SenderError("Simulation call changed");
  const updated = applyRecord(ctx, home, { canLeave: false, people: home.people, oxygen: home.oxygen }, "simulated-voice");
  const request = ctx.db.request.householdId.find(home.id)!;
  const turns = [{ speaker: "agent", text: "SIMULATION: Are you safe, can you leave, how many people need help, and is medical equipment needed?" },
    { speaker: "resident", text: `SIMULATION: ${home.people} people need transport. Mobility: ${home.mobility}. ${home.oxygen ? "Supplemental oxygen required" : "No supplemental oxygen"}. We cannot leave without assistance.` }];
  for (const turn of turns) ctx.db.transcriptLine.insert({ id: 0n, callId: call.id, ...turn, requestStatus: request.status, at: ctx.timestamp });
  ctx.db.call.id.update({ ...call, phase: "live", providerId: `simulated:${call.id}` });
  endCall(ctx, call.id, "simulated_answered");
  ctx.db.catastropheCase.householdId.update({ ...c, duringSnapshotJson: snapshot(updated), updatedAt: ctx.timestamp });
  sweepCoverage(ctx);
});

export const matchClosestDispatcher = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  requireOperator(ctx);
  const request = ctx.db.request.id.find(requestId), home = request && ctx.db.household.id.find(request.householdId);
  if (!request || !home || request.status === "closed") throw new SenderError("An open request is required");
  if (liveAssignments(ctx, requestId, ["proposed", "offered", "accepted"]).length) return;
  const busy = new Set([...ctx.db.assignment.iter()].filter(a => ["proposed", "offered", "accepted"].includes(a.status)).map(a => a.vehicleId));
  const minutesRemaining = Number(request.deadlineAt.toMillis() - ctx.timestamp.toMillis()) / 60_000;
  const candidates = [...ctx.db.vehicle.iter()].filter(v => !busy.has(v.id) && vehicleCanServe(v, needsOf(request)) && metersBetween(v, home) / 11 / 60 <= minutesRemaining)
    .sort((a, b) => metersBetween(a, home) - metersBetween(b, home) || (a.id < b.id ? -1 : 1));
  const vehicle = candidates[0];
  if (!vehicle) { ctx.db.request.id.update({ ...request, escalation: "unservable", updatedAt: ctx.timestamp }); return; }
  writePlan(ctx, { solver: "nearest-capable-free-unit", solveMs: 0, offers: [{ requestId, vehicleId: vehicle.id, stopOrder: 1,
    etaMinutes: Math.max(1, Math.ceil(metersBetween(vehicle, home) / 11 / 60)) }], replace: [], revoke: [], escalate: [] });
  const assignment = liveAssignments(ctx, requestId, ["proposed", "offered", "accepted"])[0];
  requestDispatchRoute(ctx, { assignmentId: assignment.id });
});

export const simulateFollowUp = spacetimedb.reducer({ householdId: t.u64() }, (ctx, { householdId }) => {
  requireOperator(ctx); requireDemoDatabase(ctx);
  const c = ctx.db.catastropheCase.householdId.find(householdId), request = ctx.db.request.householdId.find(householdId);
  if (!c?.duringSnapshotJson || c.runId === "live-prepared" || request?.status !== "closed") throw new SenderError("A closed simulated case with a during-event assessment is required");
  if (ctx.db.followUp.householdId.find(householdId)) return;
  const during = JSON.parse(c.duringSnapshotJson);
  const after = { ...during, canLeave: true, people: 2, safeLocation: "Simulated Houston shelter", immediateMedicalNeeds: "None reported in simulation" };
  const questions = [
    { key: "safety", prompt: "Are you now safe, and where are you staying?", answer: after.safeLocation },
    { key: "canLeave", prompt: "Can you now leave safely without rescue transport?", answer: "Yes, in this simulation" },
    { key: "people", prompt: "How many people remain with you?", answer: "2" },
    { key: "medical", prompt: "Any new injuries, oxygen, medication, mobility or equipment needs?", answer: `${after.immediateMedicalNeeds}; mobility remains ${during.mobility}; oxygen: ${during.oxygen}` },
    { key: "housing", prompt: "Do you need temporary housing, food or utilities?", answer: "Temporary housing and food requested in simulation" },
    { key: "contact", prompt: "What is your preferred safe follow-up contact method?", answer: "Simulated text only; no real sends" },
    { key: "insuranceSelf", prompt: "Do you have personal insurance coverage?", answer: "Yes (synthetic)" },
    { key: "insuranceVehicle", prompt: "Do you have vehicle insurance?", answer: "No (synthetic)" },
    { key: "insuranceProperty", prompt: "Do you have property or renters insurance?", answer: "Unknown; resident has not confirmed" },
  ];
  const changes = Object.entries(after).filter(([key, value]) => during[key] !== value).map(([field, after]) => ({ field, before: during[field] ?? null, after }));
  ctx.db.followUp.insert({ householdId, requestId: request.id, state: "completed", simulated: true, questions,
    duringSnapshotJson: c.duringSnapshotJson, changesJson: JSON.stringify(changes), insuranceSelf: true, insuranceVehicle: false, insuranceProperty: undefined, updatedAt: ctx.timestamp });
  // Follow-up evidence never rewrites rescue needs, priority, or the original assessment.
  sweepCoverage(ctx);
});

export const simulateResidentDelivery = spacetimedb.reducer({ requestId: t.u64() }, (ctx, { requestId }) => {
  requireOperator(ctx); requireDemoDatabase(ctx);
  const request = ctx.db.request.id.find(requestId), c = request && ctx.db.catastropheCase.householdId.find(request.householdId);
  if (!request || !c || c.runId === "live-prepared") throw new SenderError("A simulated scenario case is required");
  for (const message of ctx.db.message.householdId.filter(request.householdId)) if (message.state === "queued") ctx.db.message.id.update({ ...message, state: "sent", providerId: `simulated:${message.id}` });
  for (const callback of ctx.db.callback.requestId.filter(requestId)) if (callback.state === "pending") ctx.db.callback.id.update({ ...callback, state: "played" });
});
