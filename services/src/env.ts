// Every setting the services read. Secrets come from the repo's .env (see .env.example), never git.
import { SPACETIME_DATABASE, SPACETIME_URI } from "../../shared/spacetime";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Set it in the environment or .env (see .env.example).`);
  return value;
}

const optional = (name: string, fallback: string) => process.env[name] || fallback;

const listFrom = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

export const env = {
  spacetime: {
    uri: () => optional("SPACETIME_URI", SPACETIME_URI),
    database: () => optional("SPACETIME_DATABASE", SPACETIME_DATABASE),
    token: () => process.env.SPACETIME_TOKEN || undefined,
  },
  photon: {
    projectId: () => required("PHOTON_PROJECT_ID"),
    projectSecret: () => required("PHOTON_PROJECT_SECRET"),
    // "terminal" prints outbound texts instead of sending them, for testing without a line.
    provider: () => (process.env.PHOTON_PROVIDER === "terminal" ? "terminal" : "imessage"),
    // Outbound SIP from the Photon voice profile. The ElevenLabs agent dials out through it, so every
    // call shows the Photon number.
    sip: () => {
      const server = process.env.PHOTON_SIP_SERVER;
      const username = process.env.PHOTON_SIP_USERNAME;
      const password = process.env.PHOTON_SIP_PASSWORD;
      if (!server && !username && !password) return null;
      if (!server || !username || !password) throw new Error("Set all of PHOTON_SIP_SERVER, PHOTON_SIP_USERNAME and PHOTON_SIP_PASSWORD, or none.");
      return { server, username, password };
    },
  },
  voice: {
    // Container hosts assign PORT and route traffic only to it.
    port: Number(process.env.PORT || optional("VOICE_PORT", "8080")),
    // Calls started per second, most urgent first.
    callsPerSecond: Number(optional("VOICE_CALLS_PER_SECOND", "1")),
    publicUrl: () => required("VOICE_PUBLIC_URL").replace(/\/$/, ""),
    // The Photon number every call comes from.
    fromNumber: () => required("VOICE_FROM_NUMBER"),
  },
  twilio: {
    number: () => required("TWILIO_NUMBER"),
    accountSid: () => required("TWILIO_ACCOUNT_SID"),
    authToken: () => required("TWILIO_AUTH_TOKEN"),
    phoneNumberId: () => required("ELEVENLABS_TWILIO_PHONE_NUMBER_ID"),
    agentId: () => required("ELEVENLABS_TWILIO_AGENT_ID"),
    launchToken: () => required("TWILIO_OUTREACH_TOKEN"),
    webhookSecret: () => required("ELEVENLABS_TWILIO_WEBHOOK_SECRET"),
  },
  elevenlabs: {
    apiKey: () => required("ELEVENLABS_API_KEY"),
    // Written to .env by `npm run setup:elevenlabs`.
    agentId: () => required("ELEVENLABS_AGENT_ID"),
    phoneNumberId: () => required("ELEVENLABS_PHONE_NUMBER_ID"),
    webhookSecret: () => required("ELEVENLABS_WEBHOOK_SECRET"),
  },
  // Numbers the services may contact. "*" allows any real number; 555 numbers are never contacted.
  allowlist: listFrom("CONTACT_ALLOWLIST"),
};

export function isFictional(phone: string) {
  return /^\+1\d{3}555\d{4}$/.test(phone);
}

export function mayContact(phone: string) {
  if (isFictional(phone)) return false;
  return env.allowlist.includes("*") || env.allowlist.includes(phone);
}
