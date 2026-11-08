import { demoContacts } from "./demo-handoff";
import { isFictional } from "./env";
import { SPACETIME_DEMO_DATABASE, SPACETIME_URI, databaseHost } from "../../shared/spacetime";
import type { CallVariables } from "./elevenlabs";

export type OutboundCheck = { label: string; ok: boolean; detail: string };

export function receiverCheck(capabilities: { database?: string; uri?: string; transcriptIngestion?: boolean; claudeAnalysis?: boolean }): OutboundCheck {
  let hostMatches = false;
  try { hostMatches = Boolean(capabilities.uri) && databaseHost(capabilities.uri!) === databaseHost(SPACETIME_URI); } catch { /* fail closed */ }
  const ok = capabilities.database === SPACETIME_DEMO_DATABASE && hostMatches && capabilities.transcriptIngestion === true && capabilities.claudeAnalysis === true;
  return { label: "Transcript and Claude receiver", ok, detail: ok ? "Connected to hackutd-richardson" : "Receiver must archive/analyze against hackutd-richardson" };
}

export function sipCheck(phone: { provider?: string; supportsOutbound?: boolean; phoneNumber?: string; outboundTrunk?: { address?: string; transport?: string; hasAuthCredentials?: boolean; username?: string } }, expected: { phone: string; server: string; username: string }): OutboundCheck {
  const trunk = phone.outboundTrunk;
  const ok = phone.provider === "sip_trunk" && phone.supportsOutbound !== false && phone.phoneNumber === expected.phone && trunk?.address === expected.server && trunk.transport === "tls" && trunk.hasAuthCredentials === true && trunk.username === expected.username;
  return { label: "ElevenLabs outbound SIP configuration", ok, detail: ok ? "TLS trunk, originating number and credentials match the configured Photon Beta voice profile" : "Imported number or outbound TLS trunk does not match the configured voice profile" };
}

export async function dialDemoAttempt(options: {
  attemptId: string; allowlist: readonly string[];
  startAttempt: (attemptId: string) => Promise<{ callId: bigint }>;
  failed: (callId: bigint) => Promise<void>;
  dial: (phone: string, variables: CallVariables, firstMessage: string) => Promise<string>;
}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(options.attemptId)) throw new Error("Supply --attempt with 1–80 letters, numbers, underscores or hyphens");
  const target = demoContacts(options.allowlist).resident;
  if (isFictional(target)) throw new Error("The selected demo contact must be a real allowlisted phone");
  // Exactly one caller may consume a named attempt. A failed/uncertain dial never retries itself.
  const { callId } = await options.startAttempt(options.attemptId);
  try {
    const providerId = await options.dial(target, { kind: "survey", call_id: String(callId), callback_id: "", name: "Anish" },
      "Hi Anish, this is an AI calling for our simulated catastrophe-response demonstration. Are you able to leave your demo home safely, or would you need assistance?");
    return { callId, providerId };
  } catch (error) {
    // A timeout has an unknown external outcome. Leave the job open for provider reconciliation.
    // A new attempt must not overlap a call that might still be ringing.
    if (error instanceof Error && !/timeout|timed out|abort|network|fetch failed/i.test(error.message) && error.name !== "AbortError") await options.failed(callId);
    throw error;
  }
}
