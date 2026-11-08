import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agentConfig, guardedAgentConfig } from "../src/elevenlabs";
import { env } from "../src/env";

const { values } = parseArgs({ options: { config: { type: "string" }, "secret-id": { type: "string" } } });
const secretId = values["secret-id"] || process.env.ELEVENLABS_GUARD_SECRET_ID;
if (!secretId) throw new Error("Supply --secret-id for the ElevenLabs workspace secret containing VOICE_GUARD_TOKEN");
const base = values.config ? JSON.parse(readFileSync(values.config, "utf8")) : agentConfig(process.env.ELEVENLABS_WEBHOOK_ID || "");
if (!values.config && !process.env.ELEVENLABS_WEBHOOK_ID) throw new Error("Supply an existing agent config or ELEVENLABS_WEBHOOK_ID");
const config = guardedAgentConfig(base, env.voice.publicUrl(), secretId);
const directory = new URL("../.spacetime/voice-guard/", import.meta.url);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const output = new URL("agent-config.json", directory);
writeFileSync(output, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(`Prepared ${fileURLToPath(output)}. No provider settings changed, service restarted, or call placed.`);
