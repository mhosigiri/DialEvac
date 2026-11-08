import { parseArgs } from "node:util";
import { houstonConnection } from "./houston-connection";
import { HOUSTON_HISTORY, historicalRiderId } from "../../shared/houston-history";

const { values } = parseArgs({ options: { seed: { type: "boolean", default: false } } });
console.log(`Historical Houston sample: ${HOUSTON_HISTORY.length} unique report locations from 2017.`);
console.log("Residents and needs are simulated; three transport requests, no calls or texts.");
if (!values.seed) {
  console.log("Preview only. Pass --seed to populate the isolated demo database.");
} else {
  const connection = await houstonConnection();
  try {
    await connection.reducers.seedHistoricalHoustonDemo({});
    const homes = [...connection.db.household.iter()];
    const imported = HOUSTON_HISTORY.filter(row => homes.some(h => h.riderId === historicalRiderId(row.caseNumber)));
    if (imported.length !== HOUSTON_HISTORY.length) throw new Error("Historical sample subscription is incomplete");
    console.log(`Ready: ${imported.length} historical pickup locations. Existing cases were preserved.`);
  } finally { connection.disconnect(); }
}
