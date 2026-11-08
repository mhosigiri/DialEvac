import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { houstonConnection } from "./houston-connection";
import { runHoustonSimulation } from "../src/houston-simulation";

const { values } = parseArgs({ options: { hazard: { type: "string", default: "hurricane" }, "run-id": { type: "string", default: `run-${Date.now()}` },
  stage: { type: "string", default: "assessed" }, "pause-ms": { type: "string", default: "0" } } });
assert(["queued", "assessed", "routed", "closed"].includes(values.stage!), "stage must be queued, assessed, routed or closed");
const pauseMs = Number(values["pause-ms"]); assert(Number.isFinite(pauseMs) && pauseMs >= 0 && pauseMs <= 10_000);
const connection = await houstonConnection();
try { await runHoustonSimulation(connection, { hazard: values.hazard!, runId: values["run-id"]!, stage: values.stage as "queued" | "assessed" | "routed" | "closed", pauseMs }); }
finally { connection.disconnect(); }
