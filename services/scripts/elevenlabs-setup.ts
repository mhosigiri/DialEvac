import { readFileSync, writeFileSync } from "node:fs";
import { env } from "../src/env";
import { agentConfig, elevenlabs } from "../src/elevenlabs";

// Sets ElevenLabs up for the voice service and records what it made in ../.env, so a rerun updates
// instead of duplicating:
//   1. a post-call webhook pointing at VOICE_PUBLIC_URL (a new one whenever that URL changes,
//      since ElevenLabs can't edit a webhook's URL),
//   2. the agent (created once, then updated to match agentConfig),
//   3. the Photon number, imported as a SIP trunk that dials out through Photon and takes the calls
//      Photon forwards to sips:sip.rtc.elevenlabs.io:5061 (the Photon profile's inbound destination).
// Run: npm run setup:elevenlabs

const ENV_PATH = new URL("../../.env", import.meta.url);

function save(values: Record<string, string>) {
  let text = readFileSync(ENV_PATH, "utf8");
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
    const line = `${key}=${value}`;
    const existing = new RegExp(`^${key}=.*$`, "m");
    text = existing.test(text) ? text.replace(existing, line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(ENV_PATH, text);
}

async function webhook() {
  const url = `${env.voice.publicUrl()}/elevenlabs/webhook`;
  if (process.env.ELEVENLABS_WEBHOOK_ID && process.env.ELEVENLABS_WEBHOOK_URL === url) return process.env.ELEVENLABS_WEBHOOK_ID;
  const made = await elevenlabs().webhooks.create({ settings: { authType: "hmac", name: "Worst Day voice results", webhookUrl: url } });
  if (!made.webhookSecret) throw new Error("ElevenLabs returned no webhook secret");
  save({ ELEVENLABS_WEBHOOK_ID: made.webhookId, ELEVENLABS_WEBHOOK_SECRET: made.webhookSecret, ELEVENLABS_WEBHOOK_URL: url });
  console.log(`webhook: created for ${url}`);
  return made.webhookId;
}

async function agent(webhookId: string) {
  const config = agentConfig(webhookId);
  const existing = process.env.ELEVENLABS_AGENT_ID;
  if (existing) {
    await elevenlabs().conversationalAi.agents.update(existing, config);
    console.log(`agent: updated ${existing}`);
    return existing;
  }
  const made = await elevenlabs().conversationalAi.agents.create(config);
  save({ ELEVENLABS_AGENT_ID: made.agentId });
  console.log(`agent: created ${made.agentId}`);
  return made.agentId;
}

async function phoneNumber(agentId: string) {
  const sip = env.photon.sip();
  if (!sip) throw new Error("Set PHOTON_SIP_SERVER, PHOTON_SIP_USERNAME and PHOTON_SIP_PASSWORD from the Photon voice profile first.");
  const trunk = {
    address: sip.server,
    transport: "tls",
    mediaEncryption: "allowed",
    credentials: { username: sip.username, password: sip.password },
  } as const;
  // Photon's guide: no inbound credentials, any source address, encryption allowed.
  const inbound = { mediaEncryption: "allowed" as const, allowedAddresses: ["0.0.0.0/0"] };
  const existing = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (existing) {
    await elevenlabs().conversationalAi.phoneNumbers.update(existing, { agentId, outboundTrunkConfig: trunk, inboundTrunkConfig: inbound });
    return console.log(`phone: updated ${existing}`);
  }
  const made = await elevenlabs().conversationalAi.phoneNumbers.create({
    provider: "sip_trunk",
    label: "Photon line",
    phoneNumber: env.voice.fromNumber(),
    agentId,
    outboundTrunkConfig: trunk,
    inboundTrunkConfig: inbound,
  });
  save({ ELEVENLABS_PHONE_NUMBER_ID: made.phoneNumberId });
  console.log(`phone: imported ${env.voice.fromNumber()} as ${made.phoneNumberId}`);
}

const webhookId = await webhook();
await phoneNumber(await agent(webhookId));
console.log("Done. Photon's voice profile must use the SHA-256 digest for ElevenLabs.");
