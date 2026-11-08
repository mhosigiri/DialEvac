import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { DbConnection } from "../src/module_bindings";
import { contractFor, SERVICE_QUERIES } from "../src/db";
import { env } from "../src/env";
import { SPACETIME_DEMO_DATABASE, SPACETIME_URI, separateDemoDatabase } from "../../shared/spacetime";

const DASHBOARD_TABLES = ["household", "request", "vehicle", "assignment", "call", "transcript_line", "zone", "coverage", "feed_health"];
const DEMO_TABLES = [...DASHBOARD_TABLES, "message", "callback", "shelter", "road_closure"];

async function open(uri: string, database: string, queries: string[]) {
  return new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => { connection.disconnect(); reject(new Error(`Subscription timed out: ${database}`)); }, 15_000);
    const connection = DbConnection.builder().withUri(uri).withDatabaseName(database)
      .onConnect(conn => {
        conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); })
          .onError(ctx => { clearTimeout(timer); conn.disconnect(); reject(ctx.event ?? new Error("subscription failed")); })
          .subscribe(queries);
      })
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); })
      .build();
  });
}

async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await sleep(25);
  }
  throw new Error("Expected table update did not reach the subscriber");
}

const connections: DbConnection[] = [];
try {
  const uri = env.spacetime.uri(), database = env.spacetime.database();
  const service = await open(uri, database, SERVICE_QUERIES);
  connections.push(service);
  assert([...service.db.message.iter()].every(row => row.state === "queued"));
  assert([...service.db.call.iter()].every(row => row.phase !== "ended"));
  assert([...service.db.callback.iter()].every(row => row.state === "pending"));
  console.log(`Services: correct household and filtered queue tables subscribed on ${database}`);

  const dashboard = await open(uri, database, DASHBOARD_TABLES.map(table => `SELECT * FROM ${table}`));
  connections.push(dashboard);
  console.log(`Portal and live map: ${DASHBOARD_TABLES.length} table subscriptions ready on ${database}`);

  assert(separateDemoDatabase(SPACETIME_URI, SPACETIME_DEMO_DATABASE, uri, database), "Demo target must be separate from operations");
  const observer = await open(SPACETIME_URI, SPACETIME_DEMO_DATABASE, DEMO_TABLES.map(table => `SELECT * FROM ${table}`));
  connections.push(observer);
  console.log(`Demo: isolated remote table subscriptions ready on ${SPACETIME_DEMO_DATABASE}`);

  if (process.argv.includes("--write-demo")) {
    // Writes only synthetic fixture data in the dedicated demo database. Never runs telephony.
    const demoService = await open(SPACETIME_URI, SPACETIME_DEMO_DATABASE, SERVICE_QUERIES);
    connections.push(demoService);
    const contract = contractFor(demoService);
    const queued: bigint[] = [], pending: bigint[] = [];
    contract.onQueuedMessage(row => queued.push(row.id));
    contract.onPendingCallback(row => pending.push(row.id));
    await observer.reducers.seedAssistanceDemo({});
    await until(() => [...observer.db.household.iter()].some(row => row.riderId === "demo-richardson-wheelchair"));
    const home = [...observer.db.household.iter()].find(row => row.riderId === "demo-richardson-wheelchair")!;
    assert(home.simulated);
    await until(() => contract.household(home.id) !== undefined);

    for (const outcome of ["sent", "failed", "waiting"] as const) {
      const seen = queued.length;
      await contract.receiveMessage(home.phone, "status", `connector-check-${home.id}-${outcome}`);
      await until(() => queued.length > seen);
      const id = queued.at(-1)!;
      await contract.claimMessage(id);
      await until(() => ![...demoService.db.message.iter()].some(row => row.id === id));
      if (outcome === "sent") await contract.messageSent(id, "synthetic-delivery");
      if (outcome === "failed") await contract.messageFailed(id, "synthetic-failure");
      if (outcome === "waiting") await contract.messageWaiting(id, "SHARED_LINE_INBOUND_REQUIRED");
      await until(() => observer.db.message.id.find(id)?.state === outcome);
    }
    await contract.inboundCallEnded(home.phone, `connector-check-${home.id}-inbound`, { choice: "3", people: 2, oxygen: true });
    await until(() => observer.db.household.id.find(home.id)?.oxygen === true);
    await contract.updateRecord(home.id, { people: 3, oxygen: false }, "connector-check");
    await until(() => observer.db.household.id.find(home.id)?.people === 3);
    assert.equal(observer.db.household.id.find(home.id)?.oxygen, false);
    assert.equal([...observer.db.request.iter()].find(row => row.householdId === home.id)?.people, 3);

    const call = [...observer.db.call.iter()].find(row => row.householdId === home.id && row.purpose === "inbound")!;
    assert(call);
    await observer.reducers.addTranscriptLine({ callId: call.id, speaker: "user", text: "Synthetic connector check" });
    await until(() => [...observer.db.transcriptLine.iter()].some(row => row.callId === call.id));
    await observer.reducers.advanceAssistanceDemo({ phase: "approve" });
    await observer.reducers.advanceAssistanceDemo({ phase: "accept" });
    await until(() => pending.length > 0);
    const callbackId = pending.at(-1)!;
    await contract.markCallback(callbackId, "placed");
    await until(() => ![...demoService.db.callback.iter()].some(row => row.id === callbackId));
    await contract.markCallback(callbackId, "played");
    await until(() => observer.db.callback.id.find(callbackId)?.state === "played");
    console.log("Remote demo write/read checks passed: inbound messages, delivery states, household/request updates, calls, transcripts, and callbacks");
    await observer.reducers.seedAssistanceDemo({});
    console.log("Demo fixture reset for the next playback; operational database was read-only throughout");
  }
} finally {
  for (const connection of connections) connection.disconnect();
}
