import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { env } from "../src/env";
import { saveToEnvFile } from "../src/env-file";
import { elevenlabs, guardedAgentConfig, assertGuardedAgent } from "../src/elevenlabs";
import { demoAgentConfig, demoContacts } from "../src/demo-handoff";
import { outreachContacts } from "../src/twilio-outreach";
import { NOISY_ROOM_CONFIG } from "../src/voice-noise";

const { values } = parseArgs({ options: { prepare: { type: "boolean", default: false } } });
outreachContacts(env.allowlist, env.twilio.number());
env.twilio.accountSid(); env.twilio.authToken();
const updates: Record<string, string> = {};
if (!process.env.TWILIO_OUTREACH_TOKEN) updates.TWILIO_OUTREACH_TOKEN = randomBytes(32).toString("hex");
if (!process.env.VOICE_GUARD_TOKEN) updates.VOICE_GUARD_TOKEN = randomBytes(32).toString("hex");
if (Object.keys(updates).length) saveToEnvFile(updates);
if (values.prepare) {
  console.log("Private local launch and guard credentials prepared. Restart the voice receiver and Vite, then run twilio:setup. No call placed.");
} else {
  const publicUrl = env.voice.publicUrl();
  const probe = await fetch(`${publicUrl}/voice/guard/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "x-voice-guard-token": process.env.VOICE_GUARD_TOKEN! },
    body: JSON.stringify({ messages: [{ role: "user", content: "Ask the household size question." }] }), signal: AbortSignal.timeout(35000) });
  if (!probe.ok || !(await probe.text()).endsWith("data: [DONE]\n\n")) throw new Error(`Public blocking guard is not ready (${probe.status}); no agent or number changed`);
  const api = elevenlabs();
  let secretId = process.env.ELEVENLABS_TWILIO_GUARD_SECRET_ID;
  if (!secretId) {
    const secret = await api.conversationalAi.secrets.create({ name: "dialevac-twilio-guard", value: process.env.VOICE_GUARD_TOKEN! }, { maxRetries: 0, timeoutInSeconds: 15 });
    secretId = secret.secretId;
    saveToEnvFile({ ELEVENLABS_TWILIO_GUARD_SECRET_ID: secretId });
  }
  const webhookUrl = `${publicUrl}/elevenlabs/twilio-webhook`;
  if (!process.env.ELEVENLABS_TWILIO_WEBHOOK_ID || process.env.ELEVENLABS_TWILIO_WEBHOOK_URL !== webhookUrl) {
    const webhook = await elevenlabs().webhooks.create({ settings: { authType: "hmac", name: "DialEvac Twilio results", webhookUrl } });
    if (!webhook.webhookSecret) throw new Error("Twilio transcript webhook did not return its signing secret");
    await elevenlabs().webhooks.update(webhook.webhookId, { isDisabled: false, retryEnabled: true, name: "DialEvac Twilio results" });
    saveToEnvFile({ ELEVENLABS_TWILIO_WEBHOOK_ID: webhook.webhookId, ELEVENLABS_TWILIO_WEBHOOK_SECRET: webhook.webhookSecret, ELEVENLABS_TWILIO_WEBHOOK_URL: webhookUrl });
  }
  const current = await api.conversationalAi.agents.get(env.elevenlabs.agentId());
  const base = demoAgentConfig(process.env.ELEVENLABS_TWILIO_WEBHOOK_ID || "", demoContacts(env.allowlist).dispatcher, publicUrl);
  const transfer = base.conversationConfig.agent.prompt.builtInTools.transferToNumber;
  const twilioBase = { ...base, conversationConfig: { ...base.conversationConfig, agent: { ...base.conversationConfig.agent, prompt: { ...base.conversationConfig.agent.prompt,
    builtInTools: { ...base.conversationConfig.agent.prompt.builtInTools, transferToNumber: { ...transfer, params: { ...transfer.params, transfers: transfer.params.transfers.map(value => ({ ...value, transferType: "conference" as const })) } } },
  } } } };
  const guarded = guardedAgentConfig(twilioBase, publicUrl, secretId);
  const prompt = guarded.conversationConfig.agent.prompt;
  const tools = [...(prompt.tools ?? []), ...Object.values(prompt.builtInTools ?? {}).filter(tool => tool !== undefined && tool !== null).map(tool => ({ ...tool, type: "system" as const }))];
  const config = { ...guarded, name: "DialEvac Twilio outreach", conversationConfig: { ...guarded.conversationConfig,
    agent: { ...guarded.conversationConfig.agent, prompt: { ...prompt, builtInTools: {}, tools } },
    tts: current.conversationConfig.tts, asr: current.conversationConfig.asr,
    turn: { turnEagerness: "normal" as const, speculativeTurn: false, interruptionIgnoreTerms: ["um", "uh", "hmm", "mm-hmm"] },
  } };
  let agentId = process.env.ELEVENLABS_TWILIO_AGENT_ID;
  if (agentId) {
    const original = await api.conversationalAi.agents.get(agentId);
    const directory = new URL("../.spacetime/twilio/", import.meta.url); mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(new URL(`agent-before-${Date.now()}.json`, directory), JSON.stringify(original), { mode: 0o600 });
    await api.conversationalAi.agents.update(agentId, config, { maxRetries: 0, timeoutInSeconds: 20 });
  } else {
    const agent = await api.conversationalAi.agents.create(config, { maxRetries: 0, timeoutInSeconds: 20 });
    agentId = agent.agentId;
    saveToEnvFile({ ELEVENLABS_TWILIO_AGENT_ID: agentId });
  }
  assertGuardedAgent(await api.conversationalAi.agents.get(agentId), publicUrl);
  const noise = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, { method: "PATCH", headers: { "xi-api-key": env.elevenlabs.apiKey(), "content-type": "application/json" }, body: JSON.stringify({ conversation_config: NOISY_ROOM_CONFIG }), signal: AbortSignal.timeout(15000) });
  if (!noise.ok) throw new Error(`Twilio agent noise configuration failed (${noise.status})`);
  const phones = await api.conversationalAi.phoneNumbers.list();
  let phoneId = phones.find(phone => phone.provider === "twilio" && phone.phoneNumber === env.twilio.number())?.phoneNumberId;
  if (!phoneId) {
    const phone = await api.conversationalAi.phoneNumbers.create({ provider: "twilio", phoneNumber: env.twilio.number(), label: "DialEvac outbound", sid: env.twilio.accountSid(), token: env.twilio.authToken(), enableSms: false }, { maxRetries: 0, timeoutInSeconds: 30 });
    phoneId = phone.phoneNumberId;
  }
  saveToEnvFile({ ELEVENLABS_TWILIO_PHONE_NUMBER_ID: phoneId });
  console.log("Twilio number imported, guarded outbound agent verified, and busy-room speech settings applied. Restart the voice service to reload its configuration. No call placed.");
}
