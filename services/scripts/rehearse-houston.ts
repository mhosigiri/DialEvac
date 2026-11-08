import { parseArgs } from "node:util";
import { houstonConnection } from "./houston-connection";
import { runHoustonSimulation } from "../src/houston-simulation";

const { values } = parseArgs({ options: { hazard: { type: "string", default: "hurricane" }, "run-id": { type: "string", default: `rehearsal-${Date.now()}` } } });
const connection = await houstonConnection();
try { await runHoustonSimulation(connection, { hazard: values.hazard!, runId: values["run-id"]!, stage: "closed", pauseMs: 200 }); }
finally { connection.disconnect(); }
