import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { assertGuardedAgent, elevenlabs } from "../src/elevenlabs";
import { env } from "../src/env";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";

const { values } = parseArgs({ options: { config: { type: "string" }, apply: { type: "boolean", default: false } } });
if (!values.config) throw new Error("Supply --config <prepared guarded agent JSON>");
const config = JSON.parse(readFileSync(values.config, "utf8")) as ElevenLabs.conversationalAi.BodyCreateAgentV1ConvaiAgentsCreatePost;
assertGuardedAgent(config, env.voice.publicUrl());
if (!values.apply) console.log("Guarded agent configuration is valid. Preview only; no settings changed and no call placed.");
else {
  const token = process.env.VOICE_GUARD_TOKEN;
  if (!token || token.length < 32) throw new Error("VOICE_GUARD_TOKEN must be configured before applying");
  // Authenticate the deployed endpoint before switching the agent. This requests a neutral
  // unbound test turn only; it cannot dial, send a message or modify a resident record.
  const probe = await fetch(`${env.voice.publicUrl()}/voice/guard/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "x-voice-guard-token": token },
    body: JSON.stringify({ messages: [{ role: "user", content: "Ask the standard household-size question." }] }), signal: AbortSignal.timeout(30_000) });
  if (!probe.ok || !probe.headers.get("content-type")?.includes("event-stream") || !(await probe.text()).endsWith("data: [DONE]\n\n")) throw new Error("Deployed guard endpoint did not pass the authenticated check");
  const api = elevenlabs(), agentId = env.elevenlabs.agentId(), before = await api.conversationalAi.agents.get(agentId);
  const directory = new URL("../.spacetime/voice-guard/", import.meta.url); mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(new URL(`agent-before-${Date.now()}.json`, directory), JSON.stringify(before, null, 2), { mode: 0o600, flag: "wx" });
  await api.conversationalAi.agents.update(agentId, config);
  assertGuardedAgent(await api.conversationalAi.agents.get(agentId), env.voice.publicUrl());
  console.log("Blocking guard configuration applied and verified; prior agent saved privately. No call placed.");
}
