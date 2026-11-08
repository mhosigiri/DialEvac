import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import { DbConnection } from "../src/module_bindings";
import type { DispatchRoute } from "../src/module_bindings/types";
import { fetchRoadDirections } from "../src/road-router";
import { fetchGeminiRoute } from "../src/gemini-route";
import { sameRoadGeometry } from "../../shared/routing";
import { SPACETIME_URI, SPACETIME_DATABASE, SPACETIME_DEMO_DATABASE, separateDemoDatabase, databaseHost } from "../../shared/spacetime";

const { values } = parseArgs({ options: { once: { type: "boolean", default: false } } });
const uri = process.env.SPACETIME_ROUTE_URI || SPACETIME_URI, database = process.env.SPACETIME_ROUTE_DATABASE || SPACETIME_DEMO_DATABASE;
assert(separateDemoDatabase(uri, database, SPACETIME_URI, SPACETIME_DATABASE), "Operational database is forbidden");
assert(databaseHost(uri) !== databaseHost(SPACETIME_URI) || database === SPACETIME_DEMO_DATABASE, "Only the approved remote demo may be used");
const authPath = new URL("../../.spacetime/demo-auth.json", import.meta.url);
const token = process.env.SPACETIME_DEMO_SERVICE_TOKEN || (existsSync(authPath) ? JSON.parse(readFileSync(authPath, "utf8")).service?.token : undefined);
assert(token, "Supply the existing granted demo service token privately");
const handled = new Set<string>();
let queue = Promise.resolve();
let connection: DbConnection | undefined;
const schedule = (row: DispatchRoute) => {
  if (row.state !== "ready" && row.state !== "pending" && !(row.state === "failed" && row.failureReason?.startsWith("Routing provider"))) return;
  const existing = connection?.db.routeGuidance.assignmentId.find(row.assignmentId);
  if (row.state === "ready" && existing?.revision === row.revision && existing.state === "ready") return;
  const key = `${row.assignmentId}:${row.revision}`;
  if (handled.has(key)) return;
  handled.add(key);
  queue = queue.then(async () => {
    const conn = connection;
    if (!conn?.isActive) { handled.delete(key); return; }
    const origin = { lat: row.originLat, lng: row.originLng }, destination = { lat: row.destinationLat, lng: row.destinationLng };
    try {
      let result;
      try { result = await fetchGeminiRoute(origin, destination); }
      catch { result = { ...await fetchRoadDirections(origin, destination), summary: undefined, model: undefined, error: "Gemini guidance unavailable; verified road directions are still shown" }; }
      const current = conn.db.dispatchRoute.assignmentId.find(row.assignmentId);
      if (!current || current.revision !== row.revision) return;
      if (current.state !== "ready") await conn.reducers.recordDispatchRoute({ assignmentId: row.assignmentId, revision: row.revision,
        points: result.points, distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds, failureReason: undefined });
      const committed = conn.db.dispatchRoute.assignmentId.find(row.assignmentId);
      if (!committed || committed.revision !== row.revision || committed.state !== "ready") return;
      if (!sameRoadGeometry(committed.points, result.points)) throw new Error("Road geometry changed while preparing directions");
      await conn.reducers.recordRouteGuidance({ assignmentId: row.assignmentId, revision: row.revision, stepsJson: JSON.stringify(result.steps),
        summary: result.summary, model: result.model, error: result.error });
      console.log(`[routes] assignment ${row.assignmentId} revision ${row.revision}: ${result.steps.length} road directions; Gemini ${result.summary ? "ready" : "unavailable"}`);
    } catch (error) {
      const current = conn.db.dispatchRoute.assignmentId.find(row.assignmentId);
      if (current?.revision === row.revision && current.state === "ready") await conn.reducers.recordRouteGuidance({ assignmentId: row.assignmentId, revision: row.revision,
        stepsJson: "[]", summary: undefined, model: undefined, error: "Driving instructions unavailable; refresh the route to retry" }).catch(() => undefined);
      console.error(`[routes] directions failed for assignment ${row.assignmentId}, revision ${row.revision}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    await sleep(1000); // Keep the public demo router below one request per second.
  }).catch(() => { handled.delete(key); });
};
async function connect() {
  return new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => { c.disconnect(); reject(new Error("Route subscription timed out")); }, 10_000);
    const c = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); }).onError(() => { clearTimeout(timer); conn.disconnect(); reject(new Error("Route subscription failed")); })
        .subscribe(["SELECT * FROM dispatch_route", "SELECT * FROM route_guidance"]))
      .onConnectError(() => { clearTimeout(timer); reject(new Error("Route connection failed")); })
      .onDisconnect(() => { if (connection === c) { connection = undefined; handled.clear(); } }).build();
  });
}
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; connection?.disconnect(); });
do {
  try {
    if (!connection?.isActive) {
      connection = await connect();
      for (const row of connection.db.dispatchRoute.iter()) schedule(row);
      if (!values.once) {
        connection.db.dispatchRoute.onInsert((_ctx, row) => schedule(row));
        connection.db.dispatchRoute.onUpdate((_ctx, _old, row) => schedule(row));
        console.log(`[routes] Gemini + verified-road guidance worker connected on ${database}`);
      }
    }
    if (values.once) { await queue; break; }
  } catch { console.error("[routes] reconnecting after subscription failure"); }
  if (!stopping && !values.once) await sleep(3000);
} while (!stopping && !values.once);
connection?.disconnect();
