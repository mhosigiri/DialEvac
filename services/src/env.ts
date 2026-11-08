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
  },
  voice: {
    port: Number(optional("VOICE_PORT", "8080")),
    // Twilio's default is 1 call per second per account; raise both together.
    callsPerSecond: Number(optional("VOICE_CALLS_PER_SECOND", "1")),
    publicUrl: () => required("VOICE_PUBLIC_URL").replace(/\/$/, ""),
  },
  twilio: {
    accountSid: () => required("TWILIO_ACCOUNT_SID"),
    apiKeySid: () => required("TWILIO_API_KEY_SID"),
    apiKeySecret: () => required("TWILIO_API_KEY_SECRET"),
    authToken: () => required("TWILIO_AUTH_TOKEN"),
    fromNumber: () => required("TWILIO_FROM_NUMBER"),
    validateSignature: optional("TWILIO_VALIDATE_SIGNATURE", "true") === "true",
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
