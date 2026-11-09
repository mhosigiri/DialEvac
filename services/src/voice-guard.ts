import { createHmac, timingSafeEqual } from "node:crypto";
import { approvedResidentPhrases, guardResidentTurn, SPEECH, type ResidentSpeechState } from "../../spacetimedb/src/domain/honesty";
import type { Contract } from "./contract";
import { conversationSoFar, voiceModelMessages } from "./voice-history";
import { decideTurn, parseUnderstanding, UNDERSTANDING_SCHEMA } from "./voice-intake";
import { CATASTROPHES, type Catastrophe } from "../../shared/catastrophe-triage";

type Context = { kind: "survey" | "callback"; call_id: string; callback_id: string; household_id: string; expires: number; incident_category?: Catastrophe; signature: string };
export type GuardChat = { messages: { role: string; content?: unknown; [key: string]: unknown }[]; guard_context?: Context; tools?: { type: string; function: { name: string; [key: string]: unknown } }[]; elevenlabs_extra_body?: { guard_context?: Context } };
export type ProposedTurn = { content?: unknown; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] };
export type TurnProposer = (body: GuardChat, phrases: readonly string[], state?: ResidentSpeechState, transfers?: readonly string[]) => Promise<ProposedTurn>;
const signatureFor = (secret: string, context: Omit<Context, "signature">) => createHmac("sha256", secret).update(JSON.stringify(context)).digest("hex");
export function voiceGuardContext(secret: string, variables: { kind: "survey" | "callback"; call_id: string; callback_id: string; household_id?: string; incident_category?: Catastrophe }, now = Date.now()): Context {
  if (!secret) throw new Error("A call-signing secret is required");
  const context = { kind: variables.kind, call_id: variables.call_id, callback_id: variables.callback_id, household_id: variables.household_id ?? "", expires: now + 600_000, ...(variables.incident_category ? { incident_category: variables.incident_category } : {}) };
  return { ...context, signature: signatureFor(secret, context) };
}
export function validGuardContext(secret: string, value: unknown, now = Date.now()): Context | undefined {
  if (!value || typeof value !== "object") return undefined;
  const c = value as Context;
  if (!["survey", "callback"].includes(c.kind) || ![c.call_id, c.callback_id, c.household_id].every(v => typeof v === "string" && /^\d{0,20}$/.test(v)) || !Number.isSafeInteger(c.expires) || c.expires < now || c.expires > now + 600_000 || typeof c.signature !== "string" || !/^[a-f0-9]{64}$/.test(c.signature)) return undefined;
  if (c.incident_category !== undefined && !CATASTROPHES.includes(c.incident_category)) return undefined;
  const { kind, call_id, callback_id, household_id, expires } = c;
  const expected = signatureFor(secret, { kind, call_id, callback_id, household_id, expires, ...(c.incident_category ? { incident_category: c.incident_category } : {}) });
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(c.signature, "hex")) ? c : undefined;
}
export function authenticGuardHeader(expected: string | undefined, supplied: string | undefined) {
  return !!expected && expected.length >= 32 && typeof supplied === "string" && Buffer.byteLength(supplied) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
function stateFor(db: Contract, context?: Context): ResidentSpeechState | undefined {
  if (!context) return undefined; // Unbound inbound calls may ask questions, never assert dispatch facts.
  const call = context.call_id ? db.call(BigInt(context.call_id)) : undefined;
  if (context.kind === "survey" && (!call || !["ringing", "live"].includes(call.phase))) throw new Error("Guard call is no longer active");
  const id = call?.householdId ?? (context.household_id ? BigInt(context.household_id) : undefined);
  if (id === undefined || !db.household(id) || call && context.household_id && BigInt(context.household_id) !== call.householdId) throw new Error("Guard household is unavailable");
  return db.residentState?.(id);
}

// Buffer a complete proposal, refresh database truth after model latency, then release only an
// approved phrase. Upstream tokens, reasoning and arbitrary tool speech never stream to TTS.
export async function guardedCompletion(db: Contract, body: GuardChat, secret: string, propose: TurnProposer, transfers: readonly string[] = []) {
  if (!body || !Array.isArray(body.messages) || body.messages.length > 120 || body.messages.some(m => !m || !["system", "user", "assistant", "tool"].includes(m.role))) throw new Error("Invalid conversation history");
  const supplied = body.elevenlabs_extra_body?.guard_context ?? body.guard_context, context = supplied ? validGuardContext(secret, supplied) : undefined;
  if (supplied && !context) throw new Error("Invalid guard context");
  const lastUser = [...body.messages].reverse().find(message => message.role === "user")?.content;
  const checkingAudio = typeof lastUser === "string" && /^(?:(?:hello|hi|hey)[.!?,\s]*)+$|^(?:can you hear me|are you there)[.!?,\s]*$/i.test(lastUser.trim());
  const initialState = stateFor(db, context);
  const proposal = checkingAudio ? { content: SPEECH.hearing } : await propose(body, approvedResidentPhrases(initialState), initialState, transfers);
  const state = stateFor(db, context);
  const guarded = guardResidentTurn(proposal.content, state);
  const callerPhone = context?.household_id ? db.household(BigInt(context.household_id))?.phone : undefined;
  const registered = new Set((body.tools ?? []).map(t => t.function?.name));
  const tools: NonNullable<ProposedTurn["tool_calls"]> = [];
  for (const tool of (proposal.tool_calls ?? []).slice(0, 1)) {
    if (!registered.has(tool.function?.name) || tool.type !== "function" || typeof tool.id !== "string" || tool.id.length > 100) continue;
    let args: Record<string, unknown>;
    try { args = JSON.parse(tool.function.arguments); } catch { continue; }
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;
    const name = tool.function.name;
    if (name === "end_call") args = { reason: "Response-line conversation ended", message: guardResidentTurn(SPEECH.goodbye, state).text };
    else if (name === "skip_turn") args = { reason: "Pause for the resident" };
    else if (name === "voicemail_detection") args = { reason: "Automated greeting detected" };
    else if (name === "record_assessment" && context?.kind === "survey" && context.call_id) {
      const provider = db.call(BigInt(context.call_id))?.providerId;
      args = { call_id: context.call_id, conversation_id: provider && provider !== "elevenlabs" ? provider : args.conversation_id, choice: args.choice, people: args.people, oxygen: args.oxygen };
    }
    else if (name === "request_handoff" && context?.call_id && state?.assessmentRecorded) {
      const provider = db.call(BigInt(context.call_id))?.providerId;
      args = { call_id: context.call_id, conversation_id: provider && provider !== "elevenlabs" ? provider : args.conversation_id };
    }
    else if (name === "transfer_to_number" && state?.assessmentRecorded && ["requested", "ringing"].includes(state.handoffStatus ?? "") && typeof args.transfer_number === "string" && transfers.includes(args.transfer_number) && callerPhone !== args.transfer_number) args = { transfer_number: args.transfer_number, reason: "Resident requested dispatcher contact", client_message: guardResidentTurn(SPEECH.transfer, state).text, agent_message: "Resident requested a dispatcher. Please review the recorded case." };
    else continue;
    tools.push({ id: tool.id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  }
  return { content: tools.length && !proposal.content ? tools.some(tool => tool.function.name === "record_assessment") ? SPEECH.checking : null : guarded.text, tool_calls: tools.length ? tools : undefined, blocked: guarded.blocked || (proposal.tool_calls?.length ?? 0) > tools.length, reason: guarded.reason };
}

async function understandResident(url: string, key: string, request: string) {
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, signal: AbortSignal.timeout(8_000), body: request });
      if (!response.ok) throw new Error(`Voice guard upstream failed (${response.status})`);
      const result = await response.json() as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] }, choice = result.choices?.[0];
      if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") throw new Error("Voice guard upstream did not finish a complete turn");
      return parseUnderstanding(JSON.parse(choice.message.content));
    } catch (error) { failure = error; }
  }
  throw failure;
}

export const proposeVoiceTurn: TurnProposer = async (body, _phrases, state, transfers = []) => {
  const key = process.env.VOICE_GUARD_UPSTREAM_KEY || process.env.GEMINI_API_KEY || process.env.GEMINI_AI_API;
  if (!key) throw new Error("Voice guard upstream is not configured");
  const url = process.env.VOICE_GUARD_UPSTREAM_URL || "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("Voice guard upstream must use HTTPS");
  const context = body.elevenlabs_extra_body?.guard_context ?? body.guard_context, category = context?.incident_category;
  const understanding = await understandResident(url, key, JSON.stringify({
    model: process.env.VOICE_GUARD_MODEL || "gemini-3.1-flash-lite", stream: false, temperature: 0, max_tokens: 1800,
    messages: voiceModelMessages(body, category),
    response_format: { type: "json_schema", json_schema: { name: "understanding", schema: UNDERSTANDING_SCHEMA } },
  }));
  return decideTurn(understanding, conversationSoFar(body), { kind: context?.kind ?? "survey", category, state, transfers, bound: Boolean(context?.call_id), tools: new Set((body.tools ?? []).map(tool => tool.function?.name)) });
};
