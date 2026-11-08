import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import { DbConnection } from "../src/module_bindings";
import type { DispatchRoute } from "../src/module_bindings/types";
import { fetchRoadRoute } from "../src/road-router";
import { SPACETIME_URI, SPACETIME_DATABASE, SPACETIME_DEMO_DATABASE, separateDemoDatabase, databaseHost } from "../../shared/spacetime";

const { values } = parseArgs({ options: { once: { type: "boolean", default: false } } });
const uri = process.env.SPACETIME_ROUTE_URI || SPACETIME_URI, database = process.env.SPACETIME_ROUTE_DATABASE || SPACETIME_DEMO_DATABASE;
assert(separateDemoDatabase(uri, database, SPACETIME_URI, SPACETIME_DATABASE), "Operational database is forbidden");
assert(databaseHost(uri) !== databaseHost(SPACETIME_URI) || database === SPACETIME_DEMO_DATABASE, "Only the approved remote demo may be used");
assert(process.env.SPACETIME_DEMO_SERVICE_TOKEN, "Supply the existing granted demo service token privately");
const handled = new Set<string>();
let queue = Promise.resolve();
let connection: DbConnection;
const schedule = (row: DispatchRoute) => {
  if (row.state !== "pending" && !(row.state === "failed" && row.failureReason?.startsWith("Routing provider"))) return;
  const key = `${row.assignmentId}:${row.revision}`;
  if (handled.has(key)) return;
  handled.add(key);
  queue = queue.then(async () => {
    try {
      const route = await fetchRoadRoute({ lat: row.originLat, lng: row.originLng }, { lat: row.destinationLat, lng: row.destinationLng });
      await connection.reducers.recordDispatchRoute({ assignmentId: row.assignmentId, revision: row.revision, ...route, failureReason: undefined });
      console.log(`[routes] processed assignment ${row.assignmentId}, revision ${row.revision}`);
    } catch {
      await connection.reducers.recordDispatchRoute({ assignmentId: row.assignmentId, revision: row.revision, points: [], distanceMeters: undefined, durationSeconds: undefined,
        failureReason: "Routing provider unavailable" }).catch(() => undefined);
      console.error(`[routes] provider or update failed for assignment ${row.assignmentId}`);
    }
    await sleep(1000); // Keep the public demo router below one request per second.
  });
};
connection = await new Promise<DbConnection>((resolve, reject) => {
  DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(process.env.SPACETIME_DEMO_SERVICE_TOKEN)
    .onConnect(conn => conn.subscriptionBuilder().onApplied(() => resolve(conn)).onError(ctx => reject(ctx.event)).subscribe(["SELECT * FROM dispatch_route"]))
    .onConnectError((_ctx, error) => reject(error)).build();
});
for (const row of connection.db.dispatchRoute.iter()) schedule(row);
if (!values.once) {
  connection.db.dispatchRoute.onInsert((_ctx, row) => schedule(row));
  connection.db.dispatchRoute.onUpdate((_ctx, _old, row) => schedule(row));
  console.log(`[routes] route-only bridge subscribed on ${database}; voice and messaging are not started`);
  process.on("SIGINT", () => { connection.disconnect(); process.exit(0); });
  process.on("SIGTERM", () => { connection.disconnect(); process.exit(0); });
} else { await queue; connection.disconnect(); }
