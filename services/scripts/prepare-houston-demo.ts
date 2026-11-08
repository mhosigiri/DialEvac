import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { DbConnection } from "../src/module_bindings";
import { demoAgentConfig, demoContacts } from "../src/demo-handoff";
import { env } from "../src/env";
import { HOUSTON_DEMO } from "../../shared/demo";
import { SPACETIME_DEMO_DATABASE, SPACETIME_URI } from "../../shared/spacetime";
import { houstonConnection } from "./houston-connection";

const { values } = parseArgs({ options: { seed: { type: "boolean", default: false }, hazard: { type: "string", default: "hurricane" } } });
const hazard = values.hazard === "fire" ? "wildfire" : values.hazard;
if (!["hurricane", "flood", "wildfire"].includes(hazard!)) throw new Error("Choose hurricane, flood or fire");
const targets = demoContacts(env.allowlist);
const webhookId = process.env.ELEVENLABS_WEBHOOK_ID;
if (!webhookId) throw new Error("ELEVENLABS_WEBHOOK_ID is required to prepare the reviewable agent configuration");
const config = demoAgentConfig(webhookId, targets.dispatcher, env.voice.publicUrl());
const root = fileURLToPath(new URL("../.spacetime/", import.meta.url));
mkdirSync(root, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(`${root}houston-demo-`);
writeFileSync(`${directory}/agent-config.json`, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" });
writeFileSync(`${directory}/call-plan.json`, JSON.stringify({ database: SPACETIME_DEMO_DATABASE, uri: SPACETIME_URI,
  fixture: HOUSTON_DEMO, residentPhone: targets.resident, dispatcherPhone: targets.dispatcher,
  interactionLimit: 1, hazard }, null, 2), { mode: 0o600, flag: "wx" });
console.log(`Prepared private SDK agent configuration and single-call plan in ${directory}`);
console.log(`Resident ending ${targets.resident.slice(-4)}; human handoff ending ${targets.dispatcher.slice(-4)}. No provider configuration changed and no call was placed.`);

if (values.seed) {
  const connection = await new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => { c.disconnect(); reject(new Error("Demo connection timed out")); }, 15_000);
    const c = DbConnection.builder().withUri(SPACETIME_URI).withDatabaseName(SPACETIME_DEMO_DATABASE).withToken(process.env.SPACETIME_DEMO_SERVICE_TOKEN)
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); })
        .onError(ctx => { clearTimeout(timer); conn.disconnect(); reject(ctx.event); }).subscribe(["SELECT * FROM household", "SELECT * FROM call"]))
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
  });
  try {
    await connection.reducers.seedHoustonVoiceDemo({ hazard: hazard! });
    const operator = await houstonConnection();
    try { await operator.reducers.prepareHoustonDemo({}); } finally { operator.disconnect(); }
    console.log(`Houston synthetic fixture seeded on ${SPACETIME_DEMO_DATABASE}. Its phone is a fictional alias; seeding never dials.`);
  } finally { connection.disconnect(); }
}
