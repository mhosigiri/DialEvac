import { parseArgs } from "node:util";
import { elevenlabs } from "../src/elevenlabs";
import { env } from "../src/env";
import { saveToEnvFile } from "../src/env-file";

// Points the agent's post-call webhook at VOICE_PUBLIC_URL and changes nothing else on the agent.
// ElevenLabs cannot edit a webhook's URL, so a new URL needs a new webhook with a new signing secret.
const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
const client = elevenlabs(), api = client.conversationalAi.agents, agentId = env.elevenlabs.agentId();
const options = { timeoutInSeconds: 15, maxRetries: 0 };
const url = `${env.voice.publicUrl()}/elevenlabs/webhook`;
if (!url.startsWith("https://")) throw new Error("VOICE_PUBLIC_URL must use HTTPS");

const before = await api.get(agentId, {}, options);
const overrides = before.platformSettings?.workspaceOverrides;
const urlIsCurrent = process.env.ELEVENLABS_WEBHOOK_URL === url && Boolean(process.env.ELEVENLABS_WEBHOOK_ID);
if (urlIsCurrent && overrides?.webhooks?.postCallWebhookId === process.env.ELEVENLABS_WEBHOOK_ID) {
  console.log(`The agent already sends results to ${url}. Nothing changed.`);
  process.exit(0);
}
if (!values.apply) {
  console.log(`Preview only. --apply points the agent at ${url}${urlIsCurrent ? "" : " through a new webhook with a new signing secret"}.`);
  process.exit(0);
}

if (!urlIsCurrent) {
  const made = await client.webhooks.create({ settings: { authType: "hmac", name: "DialEvac voice results", webhookUrl: url } });
  if (!made.webhookSecret) throw new Error("ElevenLabs returned no webhook secret");
  await client.webhooks.update(made.webhookId, { isDisabled: false, name: "DialEvac voice results", retryEnabled: true });
  saveToEnvFile({ ELEVENLABS_WEBHOOK_ID: made.webhookId, ELEVENLABS_WEBHOOK_SECRET: made.webhookSecret, ELEVENLABS_WEBHOOK_URL: url });
}
const postCallWebhookId = process.env.ELEVENLABS_WEBHOOK_ID;
await api.update(agentId, { platformSettings: { workspaceOverrides: { ...overrides, webhooks: { ...overrides?.webhooks, postCallWebhookId } } } }, options);

const after = await api.get(agentId, {}, options);
if (after.platformSettings?.workspaceOverrides?.webhooks?.postCallWebhookId !== postCallWebhookId) throw new Error("The agent did not keep the new webhook");
if (JSON.stringify(after.conversationConfig) !== JSON.stringify(before.conversationConfig)) throw new Error("The agent's conversation settings changed unexpectedly; review them in ElevenLabs");
console.log(`The agent now sends results to ${url}. Copy ELEVENLABS_WEBHOOK_SECRET from .env to the deployed inbox, then restart it.`);
