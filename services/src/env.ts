// Every setting the services read. Secrets come from the repo's .env (see .env.example), never git.

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to .env (see .env.example).`);
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
    uri: () => optional("SPACETIME_URI", "ws://127.0.0.1:3000"),
    database: () => required("SPACETIME_DATABASE"),
    token: () => process.env.SPACETIME_TOKEN || undefined,
  },
  photon: {
    projectId: () => required("PHOTON_PROJECT_ID"),
    projectSecret: () => required("PHOTON_PROJECT_SECRET"),
    // "terminal" runs Photon's local terminal provider instead of iMessage, for testing without a line.
    provider: () => (process.env.PHOTON_PROVIDER === "terminal" ? "terminal" : "imessage"),
    // Outbound SIP from the Photon voice profile. When set, Twilio places calls through Photon so they
    // show the Photon number; when unset, Twilio dials the phone network directly.
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
    port: Number(optional("VOICE_PORT", "8080")),
    // Twilio's default is 1 call per second per account; raise both together.
    callsPerSecond: Number(optional("VOICE_CALLS_PER_SECOND", "1")),
    publicUrl: () => required("VOICE_PUBLIC_URL").replace(/\/$/, ""),
    // The Photon number every call comes from.
    fromNumber: () => required("VOICE_FROM_NUMBER"),
    // "elevenlabs": an ElevenLabs agent holds the conversation over the Photon line.
    // "twilio": Twilio speaks the survey and reads the keypad (needs a paid Twilio account to dial Photon).
    provider: () => (process.env.VOICE_PROVIDER === "twilio" ? "twilio" : "elevenlabs"),
  },
  elevenlabs: {
    apiKey: () => required("ELEVENLABS_API_KEY"),
    // Written to .env by `npm run setup:elevenlabs`.
    agentId: () => required("ELEVENLABS_AGENT_ID"),
    phoneNumberId: () => required("ELEVENLABS_PHONE_NUMBER_ID"),
    webhookSecret: () => required("ELEVENLABS_WEBHOOK_SECRET"),
  },
  twilio: {
    accountSid: () => required("TWILIO_ACCOUNT_SID"),
    apiKeySid: () => required("TWILIO_API_KEY_SID"),
    apiKeySecret: () => required("TWILIO_API_KEY_SECRET"),
    authToken: () => required("TWILIO_AUTH_TOKEN"),    validateSignature: optional("TWILIO_VALIDATE_SIGNATURE", "true") === "true",
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
