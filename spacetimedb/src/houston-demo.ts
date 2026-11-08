import { SenderError, t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { requireDemoDatabase } from "./demo-guard";
import { control, later, urgencyOf, type Tx } from "./core";
import { closeRequestRecord, insertHousehold } from "./households";
import { sweepCoverage } from "./reach";
import { isHazard } from "./domain/hazard";
import { HOUSTON_DEMO } from "../../shared/demo";
import { requireService } from "./authorization";

// One synthetic address, one queued survey, zero external calls. Repeating the CLI seed never
// creates another phone interaction and never resets a call already in progress or completed.
export function seedHoustonVoiceStory(ctx: Tx, hazard: string) {
  if (!isHazard(hazard)) throw new SenderError("unknown hazard");
  // The isolated database contains synthetic records only (the public reducer checks this).
  // Keep historical Richardson records, but retire their operations before framing Houston.
  for (const zone of ctx.db.zone.iter()) if (zone.active && !zone.externalId.startsWith("demo-houston")) ctx.db.zone.id.update({ ...zone, active: false });
  for (const home of ctx.db.household.iter()) {
    if (Math.abs(home.lat - HOUSTON_DEMO.lat) < 0.2 && Math.abs(home.lng - HOUSTON_DEMO.lng) < 0.2) continue;
    const request = ctx.db.request.householdId.find(home.id);
    if (request) closeRequestRecord(ctx, request.id);
    ctx.db.household.id.update({ ...home, inZone: false });
    for (const call of ctx.db.call.householdId.filter(home.id)) if (call.phase !== "ended") ctx.db.call.id.update({ ...call, phase: "ended", outcome: "demo_retired", endedAt: ctx.timestamp });
    for (const message of ctx.db.message.householdId.filter(home.id)) if (["queued", "waiting"].includes(message.state)) ctx.db.message.id.update({ ...message, state: "superseded", error: "Richardson stand-in retired for Houston" });
    for (const callback of ctx.db.callback.iter()) if (callback.householdId === home.id && ["pending", "placed"].includes(callback.state)) ctx.db.callback.id.update({ ...callback, state: "superseded" });
  }
  const existing = ctx.db.household.riderId.find(HOUSTON_DEMO.riderId);
  if (existing && [...ctx.db.call.householdId.filter(existing.id)].some(call => call.purpose === "survey")) {
    const zone = ctx.db.zone.externalId.find("demo-houston-catastrophe");
    if (zone && !zone.geometryJson) ctx.db.zone.id.update({ ...zone, geometryJson: JSON.stringify({ type: "Polygon", coordinates: JSON.parse(zone.rings) }) });
    sweepCoverage(ctx);
    return;
  }
  const c = control(ctx);
  ctx.db.control.id.update({ ...c, hazard, simulateVoice: false, simulateDispatch: false, simulateDrivers: false, autoApprove: false });
  let home = existing ?? insertHousehold(ctx, { ...HOUSTON_DEMO, language: "en", mobility: "walks", assistance: "none", simulated: true });
  home = ctx.db.household.id.update({ ...home, inZone: true, reach: "calling", canLeave: undefined, hazardAt: later(ctx, 45 * 60) });
  const rings = [[[-95.43, 29.74], [-95.36, 29.74], [-95.36, 29.79], [-95.43, 29.79], [-95.43, 29.74]]];
  const externalId = "demo-houston-catastrophe";
  const zone = ctx.db.zone.externalId.find(externalId);
  const fields = { source: "simulated-houston", name: `Houston ${hazard}`, event: hazard, severity: "Unspecified", rings: JSON.stringify(rings), active: true, at: ctx.timestamp,
    headline: `Houston ${hazard} response area`, issuedAt: ctx.timestamp, expiresAt: home.hazardAt, url: undefined, messageType: undefined, kind: "demo", geometryJson: JSON.stringify({ type: "Polygon", coordinates: rings }), area: "TX" };
  if (zone) ctx.db.zone.id.update({ ...zone, ...fields });
  else ctx.db.zone.insert({ id: 0n, externalId, ...fields });
  const vehicleName = "Houston rescue unit";
  if (![...ctx.db.vehicle.iter()].some(vehicle => vehicle.name === vehicleName)) ctx.db.vehicle.insert({ id: 0n, name: vehicleName, driverName: "Rescue dispatch", kind: "wheelchair-accessible van",
    seats: 3, wheelchairSpaces: 1, stretcherSpaces: 0, crew: 2, lift: true, lat: 29.770, lng: -95.405, simulated: true });
  ctx.db.call.insert({ id: 0n, householdId: home.id, purpose: "survey", phase: "queued", attempt: 1, priority: urgencyOf(ctx, home),
    outcome: undefined, providerId: undefined, queuedAt: ctx.timestamp, endedAt: undefined });
  sweepCoverage(ctx);
}

export const seedHoustonVoiceDemo = spacetimedb.reducer({ hazard: t.string() }, (ctx, { hazard }) => {
  requireDemoDatabase(ctx);
  seedHoustonVoiceStory(ctx, hazard);
});

// An explicitly invoked CLI calls this immediately before its one external dial. No scheduled
// worker consumes these rows. A consumed attempt name can never place another phone interaction.
export const startDemoOutboundAttempt = spacetimedb.reducer({ attemptId: t.string() }, (ctx, { attemptId }) => {
  requireService(ctx);
  requireDemoDatabase(ctx);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(attemptId)) throw new SenderError("Use a short alphanumeric attempt name");
  if (ctx.db.outboundDemoAttempt.attemptId.find(attemptId)) throw new SenderError("This outbound attempt was already consumed; inspect its call before choosing a new attempt name");
  const home = ctx.db.household.riderId.find(HOUSTON_DEMO.riderId);
  if (!home || !home.simulated || home.phone !== HOUSTON_DEMO.phone) throw new SenderError("Prepare the synthetic Houston resident first");
  if (control(ctx).simulateVoice) throw new SenderError("Stand-in voice must be disabled before a real demo call");
  if ([...ctx.db.call.householdId.filter(home.id)].some(call => ["ringing", "live"].includes(call.phase))) throw new SenderError("A call to this resident is already in progress");
  const call = ctx.db.call.insert({ id: 0n, householdId: home.id, purpose: "survey", phase: "ringing", attempt: 1, priority: urgencyOf(ctx, home),
    outcome: undefined, providerId: "elevenlabs", queuedAt: ctx.timestamp, endedAt: undefined });
  ctx.db.outboundDemoAttempt.insert({ attemptId, callId: call.id, householdId: home.id, createdAt: ctx.timestamp });
});
