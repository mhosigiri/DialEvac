import { SenderError, t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { requireDemoDatabase } from "./demo-guard";
import { control, later, urgencyOf, type Tx } from "./core";
import { insertHousehold } from "./households";
import { isHazard } from "./domain/hazard";
import { HOUSTON_DEMO } from "../../shared/demo";

// One synthetic address, one queued survey, zero external calls. Repeating the CLI seed never
// creates another phone interaction and never resets a call already in progress or completed.
export function seedHoustonVoiceStory(ctx: Tx, hazard: string) {
  if (!isHazard(hazard)) throw new SenderError("unknown hazard");
  const existing = ctx.db.household.riderId.find(HOUSTON_DEMO.riderId);
  if (existing && [...ctx.db.call.householdId.filter(existing.id)].some(call => call.purpose === "survey")) return;
  const c = control(ctx);
  ctx.db.control.id.update({ ...c, hazard, simulateVoice: false, simulateDispatch: false, simulateDrivers: false, autoApprove: false });
  let home = existing ?? insertHousehold(ctx, { ...HOUSTON_DEMO, language: "en", mobility: "walks", assistance: "none", simulated: true });
  home = ctx.db.household.id.update({ ...home, inZone: true, reach: "calling", canLeave: undefined, hazardAt: later(ctx, 45 * 60) });
  const rings = [[[-95.43, 29.74], [-95.36, 29.74], [-95.36, 29.79], [-95.43, 29.79], [-95.43, 29.74]]];
  const externalId = "demo-houston-catastrophe";
  const zone = ctx.db.zone.externalId.find(externalId);
  const fields = { source: "simulated-houston", name: "Houston simulation", event: `${hazard} demo`, severity: "Simulated", rings: JSON.stringify(rings), active: true, at: ctx.timestamp,
    headline: "Synthetic catastrophe for the Houston demonstration", issuedAt: ctx.timestamp, expiresAt: home.hazardAt, url: undefined, messageType: undefined, kind: "demo", geometryJson: undefined, area: "TX" };
  if (zone) ctx.db.zone.id.update({ ...zone, ...fields });
  else ctx.db.zone.insert({ id: 0n, externalId, ...fields });
  const vehicleName = "Houston demo rescue unit";
  if (![...ctx.db.vehicle.iter()].some(vehicle => vehicle.name === vehicleName)) ctx.db.vehicle.insert({ id: 0n, name: vehicleName, driverName: "Demo dispatcher", kind: "wheelchair-accessible van",
    seats: 3, wheelchairSpaces: 1, stretcherSpaces: 0, crew: 2, lift: true, lat: 29.770, lng: -95.405, simulated: true });
  ctx.db.call.insert({ id: 0n, householdId: home.id, purpose: "survey", phase: "queued", attempt: 1, priority: urgencyOf(ctx, home),
    outcome: undefined, providerId: undefined, queuedAt: ctx.timestamp, endedAt: undefined });
}

export const seedHoustonVoiceDemo = spacetimedb.reducer({ hazard: t.string() }, (ctx, { hazard }) => {
  requireDemoDatabase(ctx);
  seedHoustonVoiceStory(ctx, hazard);
});
