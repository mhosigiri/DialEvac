import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { DbConnection } from "../src/module_bindings";
import { contractFor, SERVICE_QUERIES } from "../src/db";
import { handleElevenlabsEvent } from "../src/voice";
import { SPACETIME_DATABASE, SPACETIME_DEMO_DATABASE, SPACETIME_URI, databaseHost, separateDemoDatabase } from "../../shared/spacetime";

// Synthetic fixture writes only. No voice/message runner or external provider client is started.
const uri = process.env.SPACETIME_SAFETY_URI || SPACETIME_URI;
const database = process.env.SPACETIME_SAFETY_DATABASE || SPACETIME_DEMO_DATABASE;
assert(separateDemoDatabase(uri, database, SPACETIME_URI, SPACETIME_DATABASE), "Operational database is forbidden");
assert(databaseHost(uri) !== databaseHost(SPACETIME_URI) || database === SPACETIME_DEMO_DATABASE, "Only the dedicated Maincloud demo database is allowed");
assert(process.env.SPACETIME_DEMO_OPERATOR_TOKEN && process.env.SPACETIME_DEMO_SERVICE_TOKEN, "Supply the two granted demo role tokens privately");
const queries = ["household", "request", "assignment", "vehicle", "call", "transcript_line", "callback"].map(t => `SELECT * FROM ${t}`);
const connections: DbConnection[] = [];
async function open(token?: string, subscriptions = queries) {
  const connection = await new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => { c.disconnect(); reject(new Error("Connection timed out")); }, 15_000);
    const c = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); })
        .onError(ctx => { clearTimeout(timer); conn.disconnect(); reject(ctx.event); }).subscribe(subscriptions))
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
  });
  connections.push(connection);
  return connection;
}
async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) { if (condition()) return; await sleep(25); }
  throw new Error("Expected table update was not observed");
}
let reset: DbConnection | undefined;
try {
  const viewer = await open(process.env.SPACETIME_DEMO_VIEWER_TOKEN);
  const operator = await open(process.env.SPACETIME_DEMO_OPERATOR_TOKEN);
  const service = await open(process.env.SPACETIME_DEMO_SERVICE_TOKEN, SERVICE_QUERIES);
  const contract = contractFor(service);
  await assert.rejects(viewer.reducers.closeRequest({ requestId: 1n }), /Not authorized/);
  await assert.rejects(service.reducers.closeRequest({ requestId: 1n }), /Not authorized/);
  await assert.rejects(operator.reducers.receiveMessage({ phone: "+15557002001", body: "status", providerId: "forbidden" }), /Not authorized/);
  console.log("Viewer writes and cross-role mutations denied by the live module");
  await viewer.reducers.seedAssistanceDemo({}); reset = viewer;
  await until(() => [...viewer.db.household.iter()].some(h => h.riderId === "demo-richardson-wheelchair"));
  const home = [...viewer.db.household.iter()].find(h => h.riderId === "demo-richardson-wheelchair")!;
  assert(home.simulated);
  const request = [...viewer.db.request.iter()].find(r => r.householdId === home.id)!;
  const assignment = [...viewer.db.assignment.iter()].find(a => a.requestId === request.id && a.status === "proposed")!;
  const providerId = `safety-inbound-${home.id}`;
  const transcript = [{ role: "agent", message: "Synthetic question" }, { role: "user", message: "Synthetic answer" }];
  const inbound = { type: "post_call_transcription" as const, data: { conversation_id: providerId, transcript,
    conversation_initiation_client_data: { dynamic_variables: { system__caller_id: home.phone } } } };
  await handleElevenlabsEvent(contract, inbound);
  await handleElevenlabsEvent(contract, inbound);
  await until(() => [...viewer.db.transcriptLine.iter()].length === 2);
  const call = [...viewer.db.call.iter()].find(c => c.providerId === providerId)!;
  assert(call && call.phase === "ended");
  assert.equal(contract.call(call.id), undefined); // Ended calls deliberately leave the service cache.
  await handleElevenlabsEvent(contract, { ...inbound, data: { ...inbound.data,
    conversation_initiation_client_data: { dynamic_variables: { call_id: String(call.id) } } } });
  assert.equal([...viewer.db.transcriptLine.iter()].filter(line => line.callId === call.id).length, 2);
  console.log("Real service handler linked inbound turns without call_id; retries and ended-call replay added no duplicates");
  await operator.reducers.approveOffer({ assignmentId: assignment.id });
  await operator.reducers.acceptOffer({ assignmentId: assignment.id });
  await until(() => [...viewer.db.callback.iter()].some(cb => cb.requestId === request.id));
  const callback = [...viewer.db.callback.iter()].find(cb => cb.requestId === request.id)!;
  await contract.markCallback(callback.id, "placed");
  const callbackEvent = { type: "post_call_transcription" as const, data: { conversation_id: `safety-callback-${home.id}`, transcript,
    conversation_initiation_client_data: { dynamic_variables: { callback_id: String(callback.id) } } } };
  await handleElevenlabsEvent(contract, callbackEvent);
  await handleElevenlabsEvent(contract, callbackEvent);
  await until(() => viewer.db.callback.id.find(callback.id)?.state === "played");
  assert.equal([...viewer.db.transcriptLine.iter()].length, 4);
  assert([...viewer.db.transcriptLine.iter()].every(line => ["agent", "resident"].includes(line.speaker)));
  await operator.reducers.closeRequest({ requestId: request.id });
  await until(() => viewer.db.assignment.id.find(assignment.id)?.status === "completed");
  assert.equal(viewer.db.request.id.find(request.id)?.status, "closed");
  await assert.rejects(operator.reducers.proposePlan({ solver: "safety-check", offers: [{ requestId: request.id, vehicleId: assignment.vehicleId,
    shelterId: undefined, etaMinutes: 6, stopOrder: assignment.stopOrder + 1 }], replace: [], revoke: [] }), /closed/);
  console.log(`Passed on ${database}: role boundaries, service transcript writes/retries, callback linking and vehicle release on closure`);
} finally {
  try { if (reset) await reset.reducers.seedAssistanceDemo({}); }
  finally { for (const connection of connections) connection.disconnect(); }
}
