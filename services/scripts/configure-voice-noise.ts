import { mkdirSync, writeFileSync } from "node:fs";
import { env } from "../src/env";
import { NOISY_ROOM_CONFIG } from "../src/voice-noise";

const agentId = process.env.ELEVENLABS_TWILIO_AGENT_ID || env.elevenlabs.agentId();
const url = `https://api.elevenlabs.io/v1/convai/agents/${agentId}`;
const headers = { "xi-api-key": env.elevenlabs.apiKey(), "content-type": "application/json" };
const before = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
if (!before.ok) throw new Error(`Agent lookup failed (${before.status})`);
const original: unknown = await before.json();
const directory = new URL("../.spacetime/voice-noise/", import.meta.url);
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(new URL(`before-${Date.now()}.json`, directory), JSON.stringify(original), { mode: 0o600 });
const updated = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ conversation_config: NOISY_ROOM_CONFIG }), signal: AbortSignal.timeout(15000) });
if (!updated.ok) throw new Error(`Noise settings update failed (${updated.status})`);
const response = await fetch(url, { headers });
const result = await response.json();
if (result.conversation_config?.vad?.background_voice_detection !== true || result.conversation_config?.turn?.turn_eagerness !== "normal" || result.conversation_config?.turn?.speculative_turn !== false) throw new Error("Noise settings did not persist");
console.log("Background-speech filtering enabled; normal turn-taking and filler-word interruption filtering verified. No call placed.");
