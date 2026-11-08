import { SenderError } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { requireOperator } from "./authorization";
import { requireDemoDatabase } from "./demo-guard";
import { applyRecord, insertHousehold } from "./households";
import { audit, control, later, type Tx } from "./core";
import { sweepCoverage } from "./reach";
import { HOUSTON_HISTORY, historicalRiderId } from "../../shared/houston-history";

// Real historical locations, fictional residents and needs. No contact jobs or incident timers.
export function seedHistoricalHouston(ctx: Tx) {
  const settings = control(ctx);
  ctx.db.control.id.update({ ...settings, simulateVoice: false, simulateDispatch: false, simulateDrivers: false, autoApprove: false,
    hazard: "flood", originLat: 29.7617, originLng: -95.3983 });
  const west = Math.min(...HOUSTON_HISTORY.map(r => r.lng)) - .002;
  const east = Math.max(...HOUSTON_HISTORY.map(r => r.lng)) + .002;
  const south = Math.min(...HOUSTON_HISTORY.map(r => r.lat)) - .002;
  const north = Math.max(...HOUSTON_HISTORY.map(r => r.lat)) + .002;
  const rings = [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
  const externalId = "demo-houston-history-2017";
  const prior = ctx.db.zone.externalId.find(externalId);
  const fields = { source: "historical-311-demo", name: "Historical flood reports · 2017", event: "flood", severity: "Historical",
    rings: JSON.stringify(rings), active: true, at: prior?.at ?? ctx.timestamp,
    headline: "Flood report locations and household assistance coverage",
    issuedAt: undefined, expiresAt: undefined, url: undefined, messageType: undefined,
    kind: "demo", geometryJson: JSON.stringify({ type: "Polygon", coordinates: rings }), area: "TX" };
  const zone = prior ? ctx.db.zone.id.update({ ...prior, ...fields }) : ctx.db.zone.insert({ id: 0n, externalId, ...fields });
  let inserted = 0;
  for (const [index, report] of HOUSTON_HISTORY.entries()) {
    const riderId = historicalRiderId(report.caseNumber);
    if (ctx.db.household.riderId.find(riderId)) continue; // Preserve answers, routes and completed work.
    const home = insertHousehold(ctx, { riderId, name: `Household · ${report.address.split(",")[0]}`,
      address: report.address, lat: report.lat, lng: report.lng,
      phone: `+1${index < 100 ? "832" : "346"}55501${String(index % 100).padStart(2, "0")}`,
      language: "en", mobility: index === 1 ? "wheelchair" : index === 2 ? "bedbound" : "walks",
      assistance: index === 1 ? "one_person" : index === 2 ? "two_person_lift" : "none",
      oxygen: index === 0, people: index < 3 ? 2 : 1, simulated: true });
    ctx.db.household.id.update({ ...home, inZone: true, reach: "door_check", hazardAt: later(ctx, 90 * 60) });
    // Only three demonstration cases claim an assessed transport need. The remaining locations
    // await a simulated field assessment; the historical report is not evidence of present need.
    const assessed = index < 3 ? applyRecord(ctx, ctx.db.household.id.find(home.id)!, { canLeave: false }, "simulated-historical-demo-assessment") : undefined;
    ctx.db.catastropheCase.insert({ householdId: home.id, zoneId: zone.id, hazard: "flood", runId: "historical-2017",
      callId: undefined, duringSnapshotJson: assessed ? JSON.stringify({ canLeave: false, people: assessed.people, mobility: assessed.mobility, oxygen: assessed.oxygen }) : undefined,
      simulated: true, updatedAt: ctx.timestamp });
    inserted++;
  }
  const fleet = [
    { name: "Houston oxygen unit", kind: "ambulance", seats: 3, wheelchairSpaces: 0, stretcherSpaces: 0, crew: 2, lift: true },
    { name: "Houston wheelchair unit", kind: "wheelchair-accessible van", seats: 3, wheelchairSpaces: 1, stretcherSpaces: 0, crew: 2, lift: true },
    { name: "Houston stretcher unit", kind: "ambulance", seats: 3, wheelchairSpaces: 0, stretcherSpaces: 1, crew: 2, lift: true },
  ];
  for (const unit of fleet) if (![...ctx.db.vehicle.iter()].some(v => v.name === unit.name)) {
    ctx.db.vehicle.insert({ id: 0n, ...unit, driverName: "Response team", lat: 29.770, lng: -95.405, simulated: true });
  }
  sweepCoverage(ctx);
  audit(ctx, "historical-demo", `Imported ${inserted} of ${HOUSTON_HISTORY.length} historical locations; all resident activity is simulated`);
}

export const seedHistoricalHoustonDemo = spacetimedb.reducer(ctx => {
  requireOperator(ctx);
  if (ctx.env.DEMO_MODE !== "isolated") throw new SenderError("Demo operations are disabled on this database");
  // An earlier driver fixture used importRiders, which marks every new row real. Repair only
  // those six known fixture identities at matching historical locations; never adopt other data.
  const legacy = [
    ["driver-demo-montrose-1", "502 MONTROSE, HOUSTON TX 77019"],
    ["driver-demo-leverkuhn-2", "518 LEVERKUHN, HOUSTON TX 77007"],
    ["driver-demo-allen-3", "2009 ALLEN, HOUSTON TX 77019"],
    ["driver-demo-dickson-4", "4518 DICKSON, HOUSTON TX 77007"],
    ["driver-demo-buffalo-5", "2002 BUFFALO, HOUSTON TX 77019"],
    ["driver-demo-stanford-6", "1104 STANFORD, HOUSTON TX 77019"],
  ];
  for (const [index, [riderId, address]] of legacy.entries()) {
    const home = ctx.db.household.riderId.find(riderId);
    const report = HOUSTON_HISTORY.find(r => r.address === address);
    if (!home || home.simulated || home.address !== address || !report || Math.abs(home.lat - report.lat) > .002 || Math.abs(home.lng - report.lng) > .002) continue;
    ctx.db.household.id.update({ ...home, simulated: true, phone: `+134655501${90 + index}`, lat: report.lat, lng: report.lng,
      name: home.name });
    audit(ctx, "historical-demo", `Corrected known driver fixture ${riderId} to simulated with a fictional contact`);
  }
  requireDemoDatabase(ctx);
  seedHistoricalHouston(ctx);
});
