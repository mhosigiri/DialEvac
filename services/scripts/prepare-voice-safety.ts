import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { elevenlabs } from "../src/elevenlabs";
import { env } from "../src/env";
import { withVoiceSafety, VOICE_SAFETY_VERSION } from "../src/voice-safety";

const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
const api = elevenlabs().conversationalAi.agents;
const agentId = env.elevenlabs.agentId();
const options = { timeoutInSeconds: 15, maxRetries: 0 };
const before = await api.get(agentId, options);
const current = before.conversationConfig.agent?.prompt?.prompt;
if (!current) throw new Error("Agent has no prompt; refusing to replace its configuration");
const prompt = withVoiceSafety(current);
const directory = new URL(`../.spacetime/voice-safety/${Date.now()}/`, import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(new URL("before.json", directory), JSON.stringify(before, null, 2), { mode: 0o600, flag: "wx" });
const patch = { conversationConfig: { agent: { prompt: { prompt } } } };
await writeFile(new URL("patch.json", directory), JSON.stringify(patch, null, 2), { mode: 0o600, flag: "wx" });
console.log(`Prepared ${VOICE_SAFETY_VERSION}; backup and prompt-only patch: ${fileURLToPath(directory)}`);
if (values.apply) {
  const latest = await api.get(agentId, options);
  if (latest.conversationConfig.agent?.prompt?.prompt !== current) throw new Error("Agent prompt changed concurrently; prepare a new patch");
  await api.update(agentId, patch, options);
  const after = await api.get(agentId, options);
  if (after.conversationConfig.agent?.prompt?.prompt !== prompt) throw new Error("Provider prompt verification failed");
  console.log("Safety block applied and read back. No call was placed.");
} else console.log("Preview only. Review patch.json before rerunning with --apply. No provider configuration changed.");
