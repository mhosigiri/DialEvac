import { parseArgs } from "node:util";
import { DbConnection } from "../src/module_bindings";
import { contractFor } from "../src/db";
import { env } from "../src/env";
import { outboundCall } from "../src/elevenlabs";
import { demoContacts } from "../src/demo-handoff";
import { dialSingleHoustonResident } from "../src/single-demo-call";
import { HOUSTON_DEMO } from "../../shared/demo";
import { SPACETIME_DEMO_DATABASE, SPACETIME_URI, databaseHost } from "../../shared/spacetime";

const { values } = parseArgs({ options: { call: { type: "boolean", default: false } } });
const targets = demoContacts(env.allowlist);
console.log(`Single-call plan: resident ending ${targets.resident.slice(-4)}, live human handoff ending ${targets.dispatcher.slice(-4)}, database ${SPACETIME_DEMO_DATABASE}.`);
if (!values.call) {
  console.log("Preview only. --call is the explicit real-call trigger; use only after Anish approves the prepared agent/service rollout and the selected human is ready.");
} else {
  if (!process.env.SPACETIME_DEMO_SERVICE_TOKEN) throw new Error("SPACETIME_DEMO_SERVICE_TOKEN must be set to the granted demo service identity");
  const root = env.voice.publicUrl();
  const capabilities = await fetch(`${root}/capabilities`, { signal: AbortSignal.timeout(10_000) });
  if (!capabilities.ok) throw new Error("Updated voice service is not ready; no call was placed");
  const ready = await capabilities.json() as { liveAssessment?: boolean; database?: string; uri?: string };
  if (!ready.liveAssessment || ready.database !== SPACETIME_DEMO_DATABASE || !ready.uri || databaseHost(ready.uri) !== databaseHost(SPACETIME_URI)) throw new Error("Voice service must be connected to the remote demo database");
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(env.elevenlabs.agentId())}`, { headers: { "xi-api-key": env.elevenlabs.apiKey() }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Cannot verify the demo agent configuration; no call was placed");
  const agent = await response.json() as { conversation_config?: { agent?: { prompt?: { tools?: { name?: string; api_schema?: { url?: string } }[]; built_in_tools?: { transfer_to_number?: { params?: { transfers?: { transfer_destination?: { phone_number?: string }; transfer_type?: string }[] } } } } } } };
  const prompt = agent.conversation_config?.agent?.prompt;
  const transfers = prompt?.built_in_tools?.transfer_to_number?.params?.transfers;
  if (transfers?.length !== 1 || transfers[0].transfer_destination?.phone_number !== targets.dispatcher ||
    !prompt?.tools?.some(tool => tool.name === "record_assessment" && tool.api_schema?.url === `${root}/elevenlabs/assessment`) ||
    !prompt.tools.some(tool => tool.name === "request_handoff" && tool.api_schema?.url === `${root}/elevenlabs/handoff`)) throw new Error("Prepared assessment and single-destination transfer configuration is not applied; no call was placed");
  const connection = await new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => { c.disconnect(); reject(new Error("Demo connection timed out")); }, 15_000);
    const c = DbConnection.builder().withUri(SPACETIME_URI).withDatabaseName(SPACETIME_DEMO_DATABASE).withToken(process.env.SPACETIME_DEMO_SERVICE_TOKEN)
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); })
        .onError(ctx => { clearTimeout(timer); conn.disconnect(); reject(ctx.event); }).subscribe(["SELECT * FROM household", "SELECT * FROM call"]))
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
  });
  try {
    const home = [...connection.db.household.iter()].find(row => row.riderId === HOUSTON_DEMO.riderId);
    const call = home && [...connection.db.call.iter()].find(row => row.householdId === home.id && row.purpose === "survey" && row.phase === "queued");
    if (!home || !call) throw new Error("No queued Houston demo call exists; refusing to create or retry a call automatically");
    const conversationId = await dialSingleHoustonResident(contractFor(connection), call, home, env.allowlist, outboundCall);
    console.log(`One call request accepted: ${conversationId}. No automatic retry or other resident was scheduled.`);
  } finally { connection.disconnect(); }
}
