import { SenderError, t } from "spacetimedb/server";
import { spacetimedb, tickSchedule } from "./schema";
import { audit, CONTROL_ID, control, hazardAtFor, liveAssignments, moveRequest, needsOf, nowMs, requestStatus, runAt, type Tx } from "./core";
import { applyRecord, applyZone, endCall, insertHousehold } from "./households";
import { accept } from "./offers";
import { startReachLadder, sweepCoverage } from "./reach";
import { requestReplan } from "./dispatch";
import { writePlan } from "./plans";
import { isHazard, timingForHazard } from "./domain/hazard";
import { metersBetween, progressAlong, type Point } from "./domain/geo";
import { routeMatchesLocations } from "../../shared/route-guidance";
import { requireDemoDatabase } from "./demo-guard";
import { requireInternal, requireOperator } from "./authorization";
import { MOBILITIES, vehicleCanServe } from "./domain/need";

// The night. Issuing the warning stamps the clock, sets every in-zone home's deadline, starts the
// reach ladder and the heartbeat. Each heartbeat runs the stand-ins that are switched on, moves
// vehicles, and asks the dispatcher for a re-plan when one is due.

const TICK_SECONDS = 1;
const DRIVER_ACCEPTS_AFTER_MS = 6_000;
const VEHICLE_METERS_PER_SECOND = 11;
const ARRIVED_METERS = 40;
const SWEEP_SECONDS = 30;

export const issueWarning = spacetimedb.reducer({ hazard: t.string() }, (ctx, { hazard }) => {
  requireOperator(ctx);
  startNight(ctx, hazard);
});

export function startNight(ctx: Tx, hazard: string) {
  if (!isHazard(hazard)) throw new SenderError(`unknown hazard ${hazard}`);
  const c = control(ctx);
  const generation = c.generation + 1n;
  const timing = timingForHazard(hazard);
  ctx.db.control.id.update({ ...c, hazard, warningAt: ctx.timestamp, generation, ...timing });
  for (const home of ctx.db.household.inZone.filter(true)) {
    const updated = ctx.db.household.id.update({ ...home, hazardAt: hazardAtFor(ctx, home) });
    startReachLadder(ctx, updated);
  }
  ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: runAt(ctx, TICK_SECONDS), generation });
  audit(ctx, "control", `${hazard} warning issued`);
}

export const setStandIns = spacetimedb.reducer(
  { simulateVoice: t.bool(), simulateDispatch: t.bool(), simulateDrivers: t.bool(), autoApprove: t.bool() },
  (ctx, flags) => {
    requireOperator(ctx);
    ctx.db.control.id.update({ ...control(ctx), ...flags });
  },
);

export const setHazardOrigin = spacetimedb.reducer(
  { lat: t.f64(), lng: t.f64(), firstArrivalMinutes: t.f64(), metersPerMinute: t.f64() },
  (ctx, { lat, lng, firstArrivalMinutes, metersPerMinute }) => {
    requireOperator(ctx);
    ctx.db.control.id.update({ ...control(ctx), originLat: lat, originLng: lng, firstArrivalMinutes, metersPerMinute });
  },
);

// Ends the night: the heartbeat sees a new generation and stops scheduling itself.
export const endNight = spacetimedb.reducer((ctx) => {
  requireOperator(ctx);
  const c = control(ctx);
  ctx.db.control.id.update({ ...c, warningAt: undefined, generation: c.generation + 1n });
  audit(ctx, "control", "night ended");
});

// A stand-in town around the hazard origin: simulated households, a mixed fleet and a shelter.
export const seedStandInTown = spacetimedb.reducer({ homes: t.u32() }, (ctx, { homes }) => {
  requireDemoDatabase(ctx);
  seedTown(ctx, homes);
});

export function seedTown(ctx: Tx, homes: number) {
  const c = control(ctx);
  for (let i = 0; i < homes; i++) {
    const angle = ctx.random() * 2 * Math.PI;
    const meters = 300 + ctx.random() * 2500;
    insertHousehold(ctx, {
      riderId: `sim-${ctx.db.household.count() + 1n}`,
      name: `Household ${i + 1}`,
      address: `${100 + i} Greenhaven Dr`,
      lat: c.originLat + (Math.sin(angle) * meters) / 110_540,
      lng: c.originLng + (Math.cos(angle) * meters) / (111_320 * Math.cos((c.originLat * Math.PI) / 180)),
      phone: `+1555${String(1000000 + i).slice(-7)}`,
      language: ctx.random() < 0.2 ? "es" : "en",
      ...standInRecord(ctx.random(), ctx.random()),
      assistance: "none",
      simulated: true,
    });
  }
  const fleet = [
    { name: "Van 1", driverName: "Maria", kind: "wheelchair-accessible van", seats: 4, wheelchairSpaces: 2, stretcherSpaces: 0, crew: 2, lift: true },
    { name: "Van 2", driverName: "Luis", kind: "wheelchair-accessible van", seats: 4, wheelchairSpaces: 1, stretcherSpaces: 0, crew: 1, lift: true },
    { name: "Ambulance 1", driverName: "Dana", kind: "ambulance", seats: 2, wheelchairSpaces: 0, stretcherSpaces: 1, crew: 2, lift: true },
    { name: "Bus 1", driverName: "Sam", kind: "bus", seats: 20, wheelchairSpaces: 0, stretcherSpaces: 0, crew: 1, lift: false },
  ];
  if (ctx.db.vehicle.count() === 0n) {
    for (const v of fleet) ctx.db.vehicle.insert({ id: 0n, ...v, lat: c.originLat - 0.03, lng: c.originLng - 0.03, simulated: true });
  }
  if (ctx.db.shelter.count() === 0n) {
    ctx.db.shelter.insert({ id: 0n, name: "Richardson community shelter", lat: c.originLat - 0.04, lng: c.originLng - 0.04, capacity: 500 });
  }
  audit(ctx, "seed", `stand-in town: ${homes} homes, ${fleet.length} vehicles, 1 shelter`);
}

const TORNADO_RIDER = "sim-tornado-wheelchair";
const TORNADO_ZONE = "sim-tornado";

// GeoJSON polygon around the control origin. ~3 km box, large enough for the stand-in town.
export function warningAreaAround(lat: number, lng: number): [number, number][][] {
  const dLat = 0.03;
  const dLng = 0.03;
  return [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]];
}

// The public demo seed is intentionally map-only. Outreach and transport are follow-up workflows;
// callers that exercise the full operational harness opt in through the internal helper.
export const seedTornadoDemo = spacetimedb.reducer((ctx) => {
  requireDemoDatabase(ctx);
  seedTornadoIncident(ctx, false);
});

// One synthetic tornado incident: warning polygon, mixed simulated fleet, and a wheelchair request.
export function seedTornadoIncident(ctx: Tx, activateOperations = true) {
  const already = Boolean(ctx.db.household.riderId.find(TORNADO_RIDER));
  seedTown(ctx, already ? 0 : 12);
  const c = control(ctx);
  const rings = warningAreaAround(c.originLat, c.originLng);
  const zone = ctx.db.zone.externalId.find(TORNADO_ZONE);
  const zoneRow = {
    source: "stand-in", name: "Richardson tornado warning", event: "Tornado Warning", severity: "Extreme",
    rings: JSON.stringify(rings), active: true, at: ctx.timestamp,
    headline: "Tornado warning near UTD", issuedAt: ctx.timestamp, expiresAt: undefined,
    url: undefined, messageType: "Alert", kind: "simulated",
    geometryJson: JSON.stringify({ type: "Polygon", coordinates: rings }), area: "TX",
  };
  if (zone) ctx.db.zone.id.update({ ...zone, ...zoneRow });
  else ctx.db.zone.insert({ id: 0n, externalId: TORNADO_ZONE, ...zoneRow });
  let home = ctx.db.household.riderId.find(TORNADO_RIDER);
  if (!home) {
    home = insertHousehold(ctx, {
      riderId: TORNADO_RIDER,
      name: "Tornado Ave household",
      address: "1 Tornado Ave",
      lat: c.originLat + 0.008,
      lng: c.originLng + 0.004,
      phone: "+15557001001",
      language: "en",
      mobility: "wheelchair",
      assistance: "one_person",
      simulated: true,
    });
  }
  if (activateOperations) {
    applyZone(ctx, rings);
    ctx.db.control.id.update({ ...control(ctx), simulateDispatch: true, simulateDrivers: true, autoApprove: true, simulateVoice: false });
    if (!control(ctx).warningAt || control(ctx).hazard !== "tornado") startNight(ctx, "tornado");
    applyRecord(ctx, ctx.db.household.id.find(home.id)!, { canLeave: false, people: 2, mobility: "wheelchair", assistance: "one_person" }, "stand-in");
  } else {
    const current = control(ctx);
    ctx.db.control.id.update({
      ...current,
      warningAt: undefined,
      generation: current.generation + 1n,
      simulateVoice: false,
      simulateDispatch: false,
      simulateDrivers: false,
      autoApprove: false,
    });
  }
}

// Most simulated homes walk. The prior is what a records match would know: high for the homes that
// can't walk, low otherwise, with noise.
function standInRecord(a: number, b: number) {
  const mobility = a < 0.7 ? "walks" : MOBILITIES[1 + Math.floor(((a - 0.7) / 0.3) * (MOBILITIES.length - 1))];
  return { mobility, oxygen: mobility === "bedbound" && b < 0.5, needProbability: mobility === "walks" ? b * 0.3 : 0.5 + b * 0.5 };
}

export const tick = spacetimedb.reducer({ onSchedule: tickSchedule }, { timer: tickSchedule.rowType }, (ctx, { timer }) => {
  requireInternal(ctx);
  const c = control(ctx);
  if (!c.warningAt || c.generation !== timer.generation || c.id !== CONTROL_ID) return;
  ctx.db.tickSchedule.insert({ scheduledId: 0n, scheduledAt: runAt(ctx, TICK_SECONDS), generation: timer.generation });
  heartbeat(ctx);
});

export function heartbeat(tx: Tx) {
  const c = control(tx);
  if (c.simulateVoice) standInVoice(tx);
  if (c.simulateDrivers) standInDrivers(tx);
  moveVehicles(tx);
  if (c.simulateDispatch) standInDispatch(tx);
  else requestReplan(tx, false);
  const last = tx.db.coverage.id.find(0)?.at;
  if (!last || nowMs(tx) - Number(last.toMillis()) >= SWEEP_SECONDS * 1000) sweepCoverage(tx);
}

// Simulated homes answer their queued calls: most answer, and their seeded mobility is the truth.
function standInVoice(tx: Tx) {
  for (const call of [...tx.db.call.phase.filter("queued")]) {
    const home = tx.db.household.id.find(call.householdId);
    if (!home?.simulated) continue;
    if (tx.random() < 0.25) {
      tx.db.call.id.update({ ...call, phase: "ringing" });
      endCall(tx, call.id, "no_answer");
      continue;
    }
    tx.db.call.id.update({ ...call, phase: "live" });
    applyRecord(tx, home, { canLeave: home.mobility === "walks" && tx.random() < 0.7, people: 1 + Math.floor(tx.random() * 3) }, "stand-in");
    endCall(tx, call.id, "answered");
  }
  for (const m of [...tx.db.message.state.filter("queued")]) {
    if (tx.db.household.id.find(m.householdId)?.simulated) tx.db.message.id.update({ ...m, state: "sent", providerId: "stand-in" });
  }
  for (const cb of [...tx.db.callback.state.filter("pending")]) {
    if (tx.db.household.id.find(cb.householdId)?.simulated) tx.db.callback.id.update({ ...cb, state: "played" });
  }
}

function standInDrivers(tx: Tx) {
  const now = nowMs(tx);
  for (const a of [...tx.db.assignment.status.filter("offered")]) {
    const v = tx.db.vehicle.id.find(a.vehicleId);
    if (v?.simulated && a.offeredAt && now - Number(a.offeredAt.toMillis()) >= DRIVER_ACCEPTS_AFTER_MS) accept(tx, a.id);
  }
}

// Progress comes from elapsed time because a route can double back on itself, where the
// vehicle's position alone cannot say which way along the road it is heading.
function roadProgress(tx: Tx, v: Point, assignment: { id: bigint; decidedAt?: { toMillis(): bigint } }, home: Point) {
  const route = tx.db.dispatchRoute.assignmentId.find(assignment.id);
  if (route?.state !== "ready" || !routeMatchesLocations(route, v, home)) return undefined;
  // Vehicles only move once the incident is running, so time spent waiting for it is not distance driven.
  const startedMs = Math.max(Number(route.updatedAt.toMillis()), Number(assignment.decidedAt?.toMillis() ?? 0), Number(control(tx).warningAt?.toMillis() ?? 0));
  const driven = ((nowMs(tx) - startedMs) / 1000) * VEHICLE_METERS_PER_SECOND;
  return progressAlong([{ lat: route.originLat, lng: route.originLng }, ...route.points, home], driven);
}

// Each vehicle drives to its next accepted pickup: along its road route, or straight there without one.
function moveVehicles(tx: Tx) {
  for (const v of tx.db.vehicle.iter()) {
    const next = [...tx.db.assignment.vehicleId.filter(v.id)].filter((a) => a.status === "accepted").sort((a, b) => a.stopOrder - b.stopOrder)[0];
    if (!next) continue;
    const request = tx.db.request.id.find(next.requestId);
    const home = request && tx.db.household.id.find(request.householdId);
    if (!request || !home) continue;
    const distance = metersBetween(v, home);
    if (distance <= ARRIVED_METERS) {
      tx.db.vehicle.id.update({ ...v, lat: home.lat, lng: home.lng });
      if (requestStatus(request) !== "arrived") moveRequest(tx, request, "arrived", next);
      moveRequest(tx, tx.db.request.id.find(request.id)!, "closed");
      tx.db.assignment.id.update({ ...next, status: "completed", decidedAt: tx.timestamp });
      continue;
    }
    const road = roadProgress(tx, v, next, home);
    const step = Math.min(1, (VEHICLE_METERS_PER_SECOND * TICK_SECONDS) / distance);
    tx.db.vehicle.id.update({ ...v, ...(road?.point ?? { lat: v.lat + (home.lat - v.lat) * step, lng: v.lng + (home.lng - v.lng) * step }) });
    const remaining = road?.remainingMeters ?? distance;
    const eta = Math.max(1, Math.ceil((remaining - VEHICLE_METERS_PER_SECOND) / VEHICLE_METERS_PER_SECOND / 60));
    if (requestStatus(request) === "driver_accepted") moveRequest(tx, request, "en_route", next, { etaMinutes: eta });
    else tx.db.request.id.update({ ...request, etaMinutes: eta });
  }
}

// Nearest compatible free vehicle for each waiting request. No solver, no road closures.
function standInDispatch(tx: Tx) {
  const busy = new Set([...tx.db.assignment.iter()].filter((a) => ["proposed", "offered", "accepted"].includes(a.status)).map((a) => a.vehicleId));
  const offers = [];
  const waiting = [...tx.db.request.status.filter("received"), ...tx.db.request.status.filter("reassigning")];
  waiting.sort((a, b) => Number(a.deadlineAt.toMillis() - b.deadlineAt.toMillis()));
  for (const request of waiting) {
    if (liveAssignments(tx, request.id, ["proposed", "offered", "accepted"]).length > 0) continue;
    const home = tx.db.household.id.find(request.householdId);
    if (!home) continue;
    const needs = needsOf(request);
    const choice = [...tx.db.vehicle.iter()]
      .filter((v) => !busy.has(v.id) && vehicleCanServe(v, needs))
      .sort((a, b) => metersBetween(a, home) - metersBetween(b, home))[0];
    if (!choice) continue;
    busy.add(choice.id);
    const stopOrder = [...tx.db.assignment.vehicleId.filter(choice.id)].reduce((m, a) => Math.max(m, a.stopOrder), 0) + 1;
    offers.push({ requestId: request.id, vehicleId: choice.id, etaMinutes: metersBetween(choice, home) / VEHICLE_METERS_PER_SECOND / 60, stopOrder });
  }
  if (offers.length > 0) writePlan(tx, { solver: "stand-in", solveMs: 0, offers, replace: [], revoke: [], escalate: [] });
}
