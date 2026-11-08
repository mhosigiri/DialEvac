import { createHmac, timingSafeEqual } from "node:crypto";
import type { Contract, LiveAssessment } from "./contract";

// The signed call ID comes from our outbound request, never an LLM-selected household or phone.
// The per-call secret variable is redacted by ElevenLabs; never log webhook bodies or tokens.
export function assessmentToken(secret: string, callId: bigint) {
  if (!secret || callId < 0n || callId > 0xffff_ffff_ffff_ffffn) throw new Error("Invalid assessment credentials");
  return createHmac("sha256", secret).update(`live-assessment:v1:${callId}`).digest("hex");
}

function authenticatedCall(db: Contract, secret: string, token: string | undefined, body: unknown) {
  const input = body as Record<string, unknown> | null;
  if (!input || typeof input !== "object" || typeof input.call_id !== "string" || !/^\d{1,20}$/.test(input.call_id)) return 400;
  const callId = BigInt(input.call_id);
  if (callId > 0xffff_ffff_ffff_ffffn) return 400;
  const expected = assessmentToken(secret, callId);
  if (!token || !/^[0-9a-f]{64}$/.test(token) || !timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(token, "hex"))) return 401;
  if (typeof input.conversation_id !== "string" || !input.conversation_id.trim() || input.conversation_id.length > 256) return 400;
  const call = db.call(callId);
  if (!call || call.purpose !== "survey" || !["ringing", "live"].includes(call.phase) ||
    (call.providerId && !["elevenlabs", input.conversation_id].includes(call.providerId))) return 409;
  return { callId, providerId: input.conversation_id, input };
}

export async function recordLiveAssessment(db: Contract, secret: string, token: string | undefined, body: unknown) {
  const call = authenticatedCall(db, secret, token, body);
  if (typeof call === "number") return call;
  const { callId, providerId, input } = call;
  if (typeof input.choice !== "string" || !["", "1", "2", "3", "4"].includes(input.choice) ||
    (input.people !== undefined && (!Number.isInteger(input.people) || Number(input.people) < 1 || Number(input.people) >= 50)) ||
    (input.oxygen !== undefined && typeof input.oxygen !== "boolean")) return 400;
  const answer: LiveAssessment = { callId, providerId, choice: input.choice,
    people: input.people as number | undefined, oxygen: input.oxygen as boolean | undefined };
  await db.recordCallAssessment(answer);
  return 200;
}

export async function recordLiveHandoff(db: Contract, secret: string, token: string | undefined, body: unknown, targetLabel: string) {
  const call = authenticatedCall(db, secret, token, body);
  if (typeof call === "number") return call;
  await db.reportCallHandoff({ callId: call.callId, status: "requested", targetLabel, detail: "Resident requested transfer; awaiting provider confirmation" });
  return 200;
}
