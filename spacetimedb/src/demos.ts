import { SenderError, t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { applyRecord, insertHousehold } from "./households";
import { accept } from "./offers";
import { approve, writePlan } from "./plans";
import { control, later, type Tx } from "./core";
import { seedTown } from "./loop";

export const DEMO_WHEELCHAIR = "demo-richardson-wheelchair";
export const DEMO_PENDING = "demo-richardson-no-response";

function ensureHome(tx: Tx, riderId: string, row: Parameters<typeof insertHousehold>[1]) {
  return tx.db.household.riderId.find(riderId) ?? insertHousehold(tx, row);
}

// Deterministic local-only aftermath fixture. It uses the real request/plan/offer state machine,
// but every person, phone, message, vehicle and driver is explicitly simulated.
export function seedAssistanceStory(tx: Tx) {
  seedTown(tx, 0);
  const current = control(tx);
  tx.db.control.id.update({ ...current, warningAt: undefined, generation: current.generation + 1n, simulateVoice: false, simulateDispatch: false, simulateDrivers: false, autoApprove: false });

  let wheelchair = ensureHome(tx, DEMO_WHEELCHAIR, {
    riderId: DEMO_WHEELCHAIR, name: "Elena Ruiz", address: "812 Greenhaven Dr",
    lat: 32.9850, lng: -96.7528, phone: "+15557002001", language: "en",
    mobility: "wheelchair", assistance: "one_person", simulated: true,
  });
  wheelchair = tx.db.household.id.update({ ...wheelchair, inZone: true, hazardAt: later(tx, 45 * 60), reach: "reached" });
  wheelchair = applyRecord(tx, wheelchair, { canLeave: false, people: 2, mobility: "wheelchair", assistance: "one_person" }, "simulated-demo");

  let pending = ensureHome(tx, DEMO_PENDING, {
    riderId: DEMO_PENDING, name: "No response · 604 Waterview Ln", address: "604 Waterview Ln",
    lat: 32.9715, lng: -96.7710, phone: "+15557002002", language: "en",
    mobility: "walks", assistance: "none", simulated: true,
  });
  pending = tx.db.household.id.update({ ...pending, inZone: true, hazardAt: later(tx, 30 * 60), reach: "door_check", canLeave: undefined });

  if (![...tx.db.call.householdId.filter(pending.id)].some(call => call.purpose === "demo-welfare")) {
    tx.db.call.insert({ id: 0n, householdId: pending.id, purpose: "demo-welfare", phase: "ended", attempt: 2, priority: 99, outcome: "no_answer", providerId: "simulated", queuedAt: tx.timestamp, endedAt: tx.timestamp });
  }
  if (![...tx.db.message.householdId.filter(wheelchair.id)].some(message => message.direction === "in")) {
    tx.db.message.insert({ id: 0n, householdId: wheelchair.id, direction: "in", state: "received", body: "3", requestStatus: "received", providerId: "simulated", error: undefined, at: tx.timestamp });
  }

  const closures = [
    { externalId: "demo-road-coit", street: "Coit Rd at Campbell", lat: 32.9782, lng: -96.7680 },
    { externalId: "demo-road-waterview", street: "Waterview Pkwy", lat: 32.9890, lng: -96.7598 },
  ];
  for (const closure of closures) {
    const existing = tx.db.roadClosure.externalId.find(closure.externalId);
    const row = { source: "simulated", street: closure.street, lat: closure.lat, lng: closure.lng, active: true, at: tx.timestamp };
    if (existing) tx.db.roadClosure.id.update({ ...existing, ...row });
    else tx.db.roadClosure.insert({ id: 0n, ...closure, ...row });
  }

  const request = tx.db.request.householdId.find(wheelchair.id)!;
  const existingAssignment = [...tx.db.assignment.requestId.filter(request.id)].find(a => ["proposed", "offered", "accepted"].includes(a.status));
  if (!existingAssignment && request.status === "received") {
    const van = [...tx.db.vehicle.iter()].find(vehicle => vehicle.simulated && vehicle.wheelchairSpaces > 0 && vehicle.lift);
    const shelter = [...tx.db.shelter.iter()][0];
    if (!van || !shelter) throw new SenderError("demo fleet or shelter missing");
    writePlan(tx, { solver: "simulated-demo", solveMs: 0, offers: [{ requestId: request.id, vehicleId: van.id, shelterId: shelter.id, etaMinutes: 6, stopOrder: 1 }], replace: [], revoke: [], escalate: [] });
  }
}

export const seedAssistanceDemo = spacetimedb.reducer(ctx => seedAssistanceStory(ctx));

export function advanceAssistanceStory(ctx: Tx, phase: string) {
  const home = ctx.db.household.riderId.find(DEMO_WHEELCHAIR);
  const request = home && ctx.db.request.householdId.find(home.id);
  const assignment = request && [...ctx.db.assignment.requestId.filter(request.id)].find(a => ["proposed", "offered", "accepted"].includes(a.status));
  if (!assignment) throw new SenderError("demo assignment missing");
  if (phase === "approve") {
    if (assignment.status === "proposed") approve(ctx, assignment.id);
    return;
  }
  if (phase === "accept") {
    if (assignment.status === "proposed") approve(ctx, assignment.id);
    const offered = ctx.db.assignment.id.find(assignment.id)!;
    if (offered.status === "offered") accept(ctx, offered.id);
    return;
  }
  throw new SenderError(`unknown demo phase ${phase}`);
}

export const advanceAssistanceDemo = spacetimedb.reducer({ phase: t.string() }, (ctx, { phase }) => advanceAssistanceStory(ctx, phase));
