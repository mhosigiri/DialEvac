import { houstonConnection } from "./houston-connection";
import { HOUSTON_HISTORY } from "../../shared/houston-history";
import { SPACETIME_DEMO_DATABASE } from "../../shared/spacetime";

// 6 actual affected addresses clustered around Buffalo Bayou & Montrose near the driver
export const SCENARIO_HOMES = [
  {
    riderId: "driver-demo-montrose-1",
    name: "Marcus Vance",
    address: "502 MONTROSE, HOUSTON TX 77019",
    lat: 29.7612,
    lng: -95.3927,
    phone: "+13465550190",
    language: "en",
    mobility: "wheelchair",
    assistance: "one_person",
    people: 2,
    oxygen: false,
    notes: "Ground floor water rising; wheelchair lift required",
  },
  {
    riderId: "driver-demo-leverkuhn-2",
    name: "Clara Lindqvist",
    address: "518 LEVERKUHN, HOUSTON TX 77007",
    lat: 29.7673,
    lng: -95.4007,
    phone: "+13465550191",
    language: "en",
    mobility: "walks",
    assistance: "none",
    people: 1,
    oxygen: true,
    notes: "Power outage, portable oxygen battery low",
  },
  {
    riderId: "driver-demo-allen-3",
    name: "David Ortiz",
    address: "2009 ALLEN, HOUSTON TX 77019",
    lat: 29.7604,
    lng: -95.3888,
    phone: "+13465550192",
    language: "es",
    mobility: "walks",
    assistance: "none",
    people: 3,
    oxygen: false,
    notes: "Family of 3, road flooding cutting off driveway",
  },
  {
    riderId: "driver-demo-dickson-4",
    name: "LaToya Washington",
    address: "4518 DICKSON, HOUSTON TX 77007",
    lat: 29.7656,
    lng: -95.4069,
    phone: "+13465550193",
    language: "en",
    mobility: "bedbound",
    assistance: "two_person_lift",
    people: 2,
    oxygen: false,
    notes: "Bedbound resident on second floor, stretcher crew needed",
  },
  {
    riderId: "driver-demo-buffalo-5",
    name: "Arthur Pendelton",
    address: "2002 BUFFALO, HOUSTON TX 77019",
    lat: 29.7602,
    lng: -95.3883,
    phone: "+13465550194",
    language: "en",
    mobility: "wheelchair",
    assistance: "one_person",
    people: 1,
    oxygen: false,
    notes: "Water entering living room, waiting on front porch",
  },
  {
    riderId: "driver-demo-stanford-6",
    name: "Sofia Morales",
    address: "1104 STANFORD, HOUSTON TX 77019",
    lat: 29.7567,
    lng: -95.3892,
    phone: "+13465550195",
    language: "es",
    mobility: "walks",
    assistance: "none",
    people: 2,
    oxygen: false,
    notes: "Elderly couple needing evacuation to shelter",
  },
];

// Driver's staging base location (Buffalo Bayou Park Staging)
export const DRIVER_LOCATION = {
  lat: 29.7635,
  lng: -95.3975,
  unitName: "Rescue Unit 1 - Houston Rapid Evac",
  driverName: "Alex Mercer",
};

export const PRIMARY_SHELTER = {
  name: "George R. Brown Convention Center",
  address: "1001 Avenida De Las Americas, Houston, TX 77010",
  lat: 29.7523,
  lng: -95.3582,
  capacity: 10000,
};

async function main() {
  console.log(`Connecting to ${SPACETIME_DEMO_DATABASE}...`);
  const conn = await houstonConnection();

  try {
    console.log("1. Seeding Driver Scenario: 6 simulated households at historical report locations around Buffalo Bayou & Montrose...");
    
    // Normalize known legacy fixture flags and contacts before updating this driver scenario.
    await conn.reducers.seedHistoricalHoustonDemo({});

    // Update the six simulated residents at historical report locations
    const ridersToImport = SCENARIO_HOMES.map(h => ({
      riderId: h.riderId,
      name: h.name,
      address: h.address,
      lat: h.lat,
      lng: h.lng,
      phone: h.phone,
      language: h.language,
      mobility: h.mobility,
      assistance: h.assistance,
      people: h.people,
      oxygen: h.oxygen,
      needProbability: 0.95,
    }));

    await conn.reducers.importRiders({ riders: ridersToImport });
    console.log(`✓ Imported ${ridersToImport.length} historical report addresses with simulated residents.`);

    // 2. Set zone covering all these homes so inZone becomes true
    const west = -95.43;
    const east = -95.36;
    const south = 29.73;
    const north = 29.80;
    const rings = [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
    await conn.reducers.setZone({ ringsJson: JSON.stringify(rings) });
    console.log("✓ Warning zone established over Montrose & Buffalo Bayou corridor.");

    // Wait briefly for rows to sync
    await new Promise(r => setTimeout(r, 1200));

    // Update records with canLeave: false to generate open requests
    const homes = [...conn.db.household.iter()];
    for (const h of SCENARIO_HOMES) {
      const match = homes.find(row => row.riderId === h.riderId);
      if (match) {
        await conn.reducers.updateRecord({
          householdId: match.id,
          patch: {
            canLeave: false,
            people: h.people,
            mobility: h.mobility,
            assistance: h.assistance,
            oxygen: h.oxygen,
          },
          source: "simulated-driver-scenario-intake",
        });
      }
    }
    console.log("✓ Updated household records; evacuation requests generated.");

    // Check vehicles
    const vehicles = [...conn.db.vehicle.iter()];
    let unit = vehicles.find(v => v.name === DRIVER_LOCATION.unitName || v.name.includes("Rescue") || v.name.includes("rescue"));
    if (!unit && vehicles.length > 0) {
      unit = vehicles[0];
    }

    if (unit) {
      console.log(`✓ Driver vehicle identified: ${unit.name} (ID: ${unit.id}) at (${unit.lat}, ${unit.lng})`);
      
      // Wait for SpacetimeDB to sync requests
      await new Promise(r => setTimeout(r, 1500));
      
      const latestHomes = [...conn.db.household.iter()];
      const vanceHome = latestHomes.find(h => h.riderId === "driver-demo-montrose-1");
      const requests = [...conn.db.request.iter()];
      const vanceReq = vanceHome ? requests.find(r => r.householdId === vanceHome.id && r.status !== "closed") : undefined;

      if (vanceReq) {
        console.log(`Creating active dispatch offer for ${vanceHome?.name} -> ${unit.name}...`);
        try {
          const priorAssignments = [...conn.db.assignment.iter()].filter(a => a.vehicleId === unit.id && a.status === "accepted");
          const nextStopOrder = priorAssignments.reduce((max, a) => Math.max(max, a.stopOrder), 0) + 1;
          
          await conn.reducers.proposePlan({
            solver: "scenario_dispatcher",
            offers: [{
              requestId: vanceReq.id,
              vehicleId: unit.id,
              shelterId: undefined,
              etaMinutes: 6,
              stopOrder: nextStopOrder,
            }],
            replace: [],
            revoke: [],
          });
          console.log(`✓ Offer proposed to vehicle at stop #${nextStopOrder}. Approving offer for driver...`);
          
          await new Promise(r => setTimeout(r, 800));
          const assignments = [...conn.db.assignment.iter()];
          const assigned = assignments.find(a => a.requestId === vanceReq.id && a.status === "proposed");
          if (assigned) {
            await conn.reducers.approveOffer({ assignmentId: assigned.id });
            console.log(`✓ Offer APPROVED! Assignment ID: ${assigned.id} is now LIVE and waiting for Driver Acceptance in the driver app!`);
          }
        } catch (e: any) {
          console.log("Note on offer proposal:", e?.message || e);
        }
      }
    }

    console.log("\n=== SCENARIO READY FOR DEMO ===");
    console.log(`Driver Unit: ${unit?.name || "Rescue Unit 1"}`);
    console.log(`Driver Location: ${DRIVER_LOCATION.lat}, ${DRIVER_LOCATION.lng} (Buffalo Bayou Park Staging)`);
    console.log("6 historical pickup locations (simulated residents):");
    for (const h of SCENARIO_HOMES) {
      console.log(` - ${h.name} | ${h.address} (${h.mobility}, ${h.people} pax)`);
    }
  } finally {
    conn.disconnect();
  }
}

main().catch(err => {
  console.error("Scenario seeding error:", err);
  process.exit(1);
});
