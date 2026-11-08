import { parseArgs } from "node:util";
import { houstonConnection } from "./houston-connection";
import { HOUSTON_DEMO } from "../../shared/demo";

// Closed requests are terminal, and each household has one request row for good. So this restores
// the queue with households that have no request yet, and it leaves every closed record as history.
// It starts no warning, so it queues no calls.
const NEEDS = [
  { mobility: "bedbound", assistance: "two_person_lift", people: 2, oxygen: false },
  { mobility: "wheelchair", assistance: "one_person", people: 2, oxygen: false },
  { mobility: "walks", assistance: "none", people: 1, oxygen: true },
  { mobility: "walks", assistance: "none", people: 3, oxygen: false },
  { mobility: "bedbound", assistance: "two_person_lift", people: 2, oxygen: false },
  { mobility: "wheelchair", assistance: "one_person", people: 1, oxygen: false },
  { mobility: "walks", assistance: "none", people: 2, oxygen: true },
  { mobility: "walks", assistance: "none", people: 2, oxygen: false },
  { mobility: "bedbound", assistance: "two_person_lift", people: 2, oxygen: false },
  { mobility: "wheelchair", assistance: "one_person", people: 2, oxygen: false },
  { mobility: "walks", assistance: "none", people: 2, oxygen: true },
  { mobility: "walks", assistance: "none", people: 2, oxygen: false },
  { mobility: "bedbound", assistance: "two_person_lift", people: 2, oxygen: false },
];
const STAGING = { lat: 29.77, lng: -95.405 };
const MARGIN = 0.002;

const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
const conn = await houstonConnection();
try {
  const homes = [...conn.db.household.iter()];
  const houston = homes.filter(h => Math.abs(h.lat - HOUSTON_DEMO.lat) < 0.2 && Math.abs(h.lng - HOUSTON_DEMO.lng) < 0.2);
  const unsimulated = houston.filter(h => !h.simulated);
  if (unsimulated.length) throw new Error(`${unsimulated.length} Houston households are not simulated; refusing to change them`);

  const lats = houston.map(h => h.lat), lngs = houston.map(h => h.lng);
  const [west, east, south, north] = [Math.min(...lngs) - MARGIN, Math.max(...lngs) + MARGIN, Math.min(...lats) - MARGIN, Math.max(...lats) + MARGIN];
  const rings = [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
  const outside = houston.filter(h => !h.inZone).length;

  const requests = [...conn.db.request.iter()];
  const withRequest = new Set(requests.map(r => r.householdId));
  const liveAssignment = new Set([...conn.db.assignment.iter()].filter(a => ["proposed", "offered", "accepted"].includes(a.status)).map(a => a.requestId));
  const waiting = requests.filter(r => r.status !== "closed" && !liveAssignment.has(r.id)).length;
  const liveCall = new Set([...conn.db.call.iter()].filter(c => c.phase !== "ended").map(c => c.householdId));
  const distance = (h: { lat: number; lng: number }) => Math.hypot(h.lat - STAGING.lat, h.lng - STAGING.lng);
  const chosen = houston
    .filter(h => h.riderId.startsWith("demo-houston-history-") && !withRequest.has(h.id) && h.canLeave === undefined && !liveCall.has(h.id))
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, Math.max(0, NEEDS.length - waiting));

  console.log(`Houston households ${houston.length}, outside the zone ${outside}, requests waiting for a unit ${waiting}.`);
  console.log(`Zone: west ${west.toFixed(4)}, east ${east.toFixed(4)}, south ${south.toFixed(4)}, north ${north.toFixed(4)}.`);
  chosen.forEach((h, i) => console.log(`  ${h.id} ${h.address}: ${NEEDS[i].mobility}, ${NEEDS[i].people} people${NEEDS[i].oxygen ? ", oxygen" : ""}`));
  if (!values.apply) {
    console.log("Preview only. --apply restores the zone and opens these requests on the isolated demo database.");
  } else {
    if (outside) await conn.reducers.setZone({ ringsJson: JSON.stringify(rings) });
    for (const [i, home] of chosen.entries()) {
      await conn.reducers.updateRecord({ householdId: home.id, patch: { canLeave: false, ...NEEDS[i] }, source: "simulated-demo-restore" });
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    const open = [...conn.db.request.iter()].filter(r => r.status !== "closed").length;
    const inZone = [...conn.db.household.iter()].filter(h => h.inZone).length;
    console.log(`Done. Households in the zone ${inZone}, open requests ${open}.`);
  }
} finally {
  conn.disconnect();
}
process.exit(0);
