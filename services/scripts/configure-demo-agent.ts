import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { elevenlabs } from "../src/elevenlabs";
import { env } from "../src/env";
import { demoContacts, type demoAgentConfig } from "../src/demo-handoff";

// Prepared for Anish to run after approval. Default is a local preview; never start services here.
const { values } = parseArgs({ options: { config: { type: "string" }, apply: { type: "boolean", default: false } } });
assert(values.config, "Supply --config <private agent-config.json from demo:prepare>");
const config = JSON.parse(readFileSync(values.config, "utf8")) as ReturnType<typeof demoAgentConfig>;
const target = demoContacts(env.allowlist).dispatcher;
const transfers = config.conversationConfig.agent.prompt.builtInTools?.transferToNumber?.params?.transfers;
assert(transfers?.length === 1 && transfers[0].transferDestination.phoneNumber === target, "Prepared config must transfer only to the selected allowlisted dispatcher");
console.log(`Prepared agent update; transfer target ending ${target.slice(-4)}. Voice and messaging stay stopped.`);
if (!values.apply) console.log("Preview only. Anish may add --apply after approving the live configuration change.");
else {
  const client = elevenlabs(), agentId = env.elevenlabs.agentId();
  const backupRoot = new URL("../.spacetime/", import.meta.url); mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const before = await client.conversationalAi.agents.get(agentId);
  writeFileSync(new URL(`agent-before-demo-${Date.now()}.json`, backupRoot), JSON.stringify(before, null, 2), { mode: 0o600, flag: "wx" });
  await client.conversationalAi.agents.update(agentId, config);
  console.log("Prepared configuration applied; prior settings backed up privately. No call was placed.");
}
