import http from "node:http";
import { env, isFictional, mayContact } from "./env";
import { endedOn, failureOutcome, outboundCall, surveyAnswer, verifiedEvent, type WebhookEvent } from "./elevenlabs";
import type { CallbackRow, CallRow, Contract, HouseholdRow, ConversationTranscript } from "./contract";
import { recordLiveAssessment, recordLiveHandoff } from "./live-assessment";
import { demoContacts } from "./demo-handoff";
import { authenticGuardHeader, guardedCompletion, proposeVoiceTurn, type GuardChat, type TurnProposer } from "./voice-guard";
import { guardResidentTurn } from "../../spacetimedb/src/domain/honesty";

// The voice service. Places queued survey calls and pending callbacks at a paced rate from the
// Photon number, where an ElevenLabs agent holds the conversation, and takes each one's result back
// by webhook. Residents who call the Photon number reach the same agent. Fictional 555 numbers are
// left for the stand-in voice in the module.
//
//   POST /elevenlabs/webhook   a finished or failed call, outbound or inbound
//   GET  /health

// Calls wait here and leave at the account's rate, most urgent first. A callback tells someone a
// ride is coming, so it outranks every survey.
const CALLBACK_PRIORITY = Number.MAX_SAFE_INTEGER;

type Job = { priority: number; run: () => Promise<void> };

export function callQueue() {
  const jobs: Job[] = [];
  return {
    push: (priority: number, run: Job["run"]) => void jobs.push({ priority, run }),
    take(count: number) {
      jobs.sort((a, b) => b.priority - a.priority);
      return jobs.splice(0, count);
    },
  };
}

function pace(queue: ReturnType<typeof callQueue>, perSecond: number) {
  setInterval(() => {
    for (const job of queue.take(perSecond)) job.run().catch((error: unknown) => console.error("[voice]", error));
  }, 1000);
}

// How a call is placed: the ElevenLabs agent dials out over the Photon SIP trunk. Tests pass a fake.
export type Dialer = {
  survey(call: CallRow, home: HouseholdRow): Promise<void>;
  callback(callback: CallbackRow, home: HouseholdRow): Promise<void>;
};

export const photonDialer: Dialer = {
  survey: (call, home) => outboundCall(home.phone, { kind: "survey", call_id: String(call.id), callback_id: "", household_id: String(home.id), name: home.name }).then(() => undefined),
  callback: (cb, home) =>
    outboundCall(home.phone, { kind: "callback", call_id: "", callback_id: String(cb.id), household_id: String(home.id), name: home.name }, cb.line).then(() => undefined),
};

export function startRunners(db: Contract, enqueue: (priority: number, job: () => Promise<void>) => void, dialer: Dialer) {
  db.onQueuedCall((call) => {
    const home = db.household(call.householdId);
    if (!home || isFictional(home.phone)) return;
    enqueue(call.priority, async () => {
      try {
        await db.claimCall(call.id, "elevenlabs");
      } catch {
        return;
      }
      if (!mayContact(home.phone)) return db.callEnded(call.id, "not_allowed");
      await dialer.survey(call, home).catch((error: unknown) => {
        console.error("[voice] survey call failed", error);
        return db.callEnded(call.id, "failed");
      });
    });
  });
  db.onPendingCallback((callback) => {
    const home = db.household(callback.householdId);
    if (!home || isFictional(home.phone)) return;
    enqueue(CALLBACK_PRIORITY, async () => {
      if (!mayContact(home.phone)) return db.markCallback(callback.id, "unanswered");
      if (guardResidentTurn(callback.line, db.residentState?.(home.id)).blocked) return db.markCallback(callback.id, "unanswered");
      await db.markCallback(callback.id, "placed");
      await dialer.callback(callback, home).catch((error: unknown) => {
        console.error("[voice] callback failed", error);
        return db.markCallback(callback.id, "unanswered");
      });
    });
  });
}

// A finished ElevenLabs call. A survey that heard one of the four choices fills the record the same
// way a pressed key does; one that didn't ends as answered (or voicemail) and the reach ladder
// tries again, because picking up is not being reached. ElevenLabs retries webhooks, and every
// step here is safe to repeat.
export async function handleElevenlabsEvent(db: Contract, event: WebhookEvent) {
  if (event.type !== "post_call_transcription" && event.type !== "call_initiation_failure") return;
  const variables = "conversation_initiation_client_data" in event.data ? event.data.conversation_initiation_client_data?.dynamic_variables : undefined;
  const failed = event.type === "call_initiation_failure";
  const conversation = failed ? undefined : (event as Extract<WebhookEvent, { type: "post_call_transcription" }>).data;
  const callId = variables?.call_id ? BigInt(variables.call_id) : undefined;
  const callbackId = variables?.callback_id ? BigInt(variables.callback_id) : undefined;
  const turns: ConversationTranscript["turns"] = (conversation?.transcript ?? []).flatMap(turn => {
    if (!["agent", "user"].includes(turn.role) || typeof turn.message !== "string" || !turn.message.trim()) return [];
    return [{ speaker: turn.role === "agent" ? "agent" as const : "resident" as const, text: turn.message }];
  });
  if (conversation && callId !== undefined) {
    const transfers = (conversation.transcript ?? []).flatMap(turn => turn.tool_results ?? []).filter(result => result.tool_name === "transfer_to_number");
    for (const result of transfers) {
      const targetLabel = `Demo dispatcher ending ${demoContacts(env.allowlist).dispatcher.slice(-4)}`;
      if (result.is_error || result.result?.result_type === "transfer_to_number_error") {
        await db.reportCallHandoff({ callId, status: "failed", targetLabel, failureReason: "Phone provider reported a transfer failure" });
      } else if (result.result?.result_type === "transfer_to_number_sip_success") {
        // SIP success acknowledges REFER, not a verified human answer. Keep status truthful.
        await db.reportCallHandoff({ callId, status: "requested", targetLabel, detail: "SIP REFER accepted; recipient connection is unconfirmed" });
      }
    }
  }
  if (callbackId !== undefined) {
    if (conversation && turns.length) await db.recordCallTranscript({ providerId: conversation.conversation_id, callbackId, turns });
    return db.markCallback(callbackId, failed ? "unanswered" : "played");
  }
  const answer = surveyAnswer(conversation?.analysis?.data_collection_results);
  if (callId === undefined) {
    const caller = conversation?.conversation_initiation_client_data?.dynamic_variables?.system__caller_id;
    if (!conversation || !caller) return;
    await db.inboundCallEnded(caller, conversation.conversation_id, { ...answer, choice: answer.choice ?? "" });
    if (turns.length) await db.recordCallTranscript({ providerId: conversation.conversation_id, phone: caller, turns });
    return;
  }
  if (failed) return db.callEnded(callId, failureOutcome((event.data as { failure_reason?: string }).failure_reason));
  if (conversation && turns.length) await db.recordCallTranscript({ providerId: conversation.conversation_id, callId, turns });
  const call = db.call(callId);
  if (answer.choice && call) {
    const known = Object.fromEntries(Object.entries({ people: answer.people, oxygen: answer.oxygen }).filter(([, v]) => v !== undefined));
    if (Object.keys(known).length > 0) await db.updateRecord(call.householdId, known, "voice");
    return db.recordDigit(callId, answer.choice);
  }
  return db.callEnded(callId, endedOn(conversation?.metadata?.termination_reason));
}

async function readBody(req: http.IncomingMessage, limit = Infinity) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += (chunk as Buffer).length;
    if (bytes > limit) throw new Error("request too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

export type Readiness = { ready: boolean; checks: Record<string, boolean> };

export function createServer(db: Contract, options: { onWebhook?: (event: WebhookEvent) => Promise<void>; capabilities?: Record<string, unknown>; readiness?: () => Readiness; proposeTurn?: TurnProposer } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return void res.writeHead(200).end("ok");
    if (req.method === "GET" && url.pathname === "/ready") {
      const state = options.readiness?.() ?? { ready: false, checks: { readinessConfigured: false } };
      return void res.writeHead(state.ready ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(state));
    }
    if (req.method === "GET" && url.pathname === "/capabilities") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ liveAssessment: true, honestyGuard: "blocking-template-gate", ...db.target, ...options.capabilities }));
    if (req.method === "POST" && ["/voice/guard/v1", "/voice/guard/v1/chat/completions"].includes(url.pathname)) {
      const supplied = req.headers["x-voice-guard-token"];
      if (!authenticGuardHeader(process.env.VOICE_GUARD_TOKEN, typeof supplied === "string" ? supplied : undefined)) return void res.writeHead(401).end();
      let body: GuardChat;
      try { body = JSON.parse(await readBody(req, 256_000)); } catch { return void res.writeHead(400).end(); }
      try {
        let transfers: string[] = [];
        try { transfers = [demoContacts(env.allowlist).dispatcher]; } catch { /* No configured human destination. */ }
        const turn = await guardedCompletion(db, body, env.elevenlabs.webhookSecret(), options.proposeTurn ?? proposeVoiceTurn, transfers);
        const base = { id: "guarded-turn", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "blocking-template-gate" };
        const delta = { role: "assistant", content: turn.content, ...(turn.tool_calls ? { tool_calls: turn.tool_calls.map((tool, index) => ({ index, ...tool })) } : {}) };
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        res.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: turn.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
      } catch { res.writeHead(503).end(); }
      return;
    }
    if (req.method === "POST" && ["/elevenlabs/assessment", "/elevenlabs/handoff"].includes(url.pathname)) {
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 16_384)); } catch { return void res.writeHead(400).end(); }
      const token = req.headers["x-assessment-token"];
      const handoff = url.pathname.endsWith("/handoff");
      let operation: Promise<number>;
      try { operation = handoff
        ? recordLiveHandoff(db, env.elevenlabs.webhookSecret(), typeof token === "string" ? token : undefined, body, `Demo dispatcher ending ${demoContacts(env.allowlist).dispatcher.slice(-4)}`)
        : recordLiveAssessment(db, env.elevenlabs.webhookSecret(), typeof token === "string" ? token : undefined, body); }
      catch { return void res.writeHead(503).end(); }
      return operation.then(
        status => void res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(handoff ? { requested: status === 200 } : { recorded: status === 200 })),
        () => void res.writeHead(503).end(),
      );
    }
    if (req.method !== "POST" || url.pathname !== "/elevenlabs/webhook") return void res.writeHead(404).end();
    let raw: string;
    try { raw = await readBody(req, 2_000_000); } catch { return void res.writeHead(413).end(); }
    const event = await verifiedEvent(raw, req.headers["elevenlabs-signature"] as string | undefined, env.elevenlabs.webhookSecret());
    if (!event) return void res.writeHead(401).end();
    return (options.onWebhook ? options.onWebhook(event) : handleElevenlabsEvent(db, event)).then(
      () => void res.writeHead(200).end(),
      (error: unknown) => {
        console.error("[voice] ElevenLabs webhook failed", error);
        res.writeHead(500).end();
      },
    );
  });
}

async function main() {
  const { connect } = await import("./db"); // generated bindings load only when the service runs
  const db = await connect();
  const queue = callQueue();
  startRunners(db, queue.push, photonDialer);
  pace(queue, env.voice.callsPerSecond);
  createServer(db).listen(env.voice.port, () => console.log(`[voice] listening on :${env.voice.port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
