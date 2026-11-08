import http from "node:http";
import { env, isFictional, mayContact } from "./env";
import { endedOn, failureOutcome, outboundCall, surveyAnswer, verifiedEvent, type WebhookEvent } from "./elevenlabs";
import type { CallbackRow, CallRow, Contract, HouseholdRow } from "./contract";

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
  survey: (call, home) => outboundCall(home.phone, { kind: "survey", call_id: String(call.id), callback_id: "", name: home.name }).then(() => undefined),
  callback: (cb, home) =>
    outboundCall(home.phone, { kind: "callback", call_id: "", callback_id: String(cb.id), name: home.name }, cb.line).then(() => undefined),
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
  if (callbackId !== undefined) return db.markCallback(callbackId, failed ? "unanswered" : "played");
  const answer = surveyAnswer(conversation?.analysis?.data_collection_results);
  if (callId === undefined) {
    const caller = conversation?.conversation_initiation_client_data?.dynamic_variables?.system__caller_id;
    if (!conversation || !caller) return;
    return db.inboundCallEnded(caller, conversation.conversation_id, { ...answer, choice: answer.choice ?? "" });
  }
  if (failed) return db.callEnded(callId, failureOutcome((event.data as { failure_reason?: string }).failure_reason));
  const call = db.call(callId);
  if (answer.choice && call) {
    const known = Object.fromEntries(Object.entries({ people: answer.people, oxygen: answer.oxygen }).filter(([, v]) => v !== undefined));
    if (Object.keys(known).length > 0) await db.updateRecord(call.householdId, known, "voice");
    return db.recordDigit(callId, answer.choice);
  }
  return db.callEnded(callId, endedOn(conversation?.metadata?.termination_reason));
}

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

export function createServer(db: Contract) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return void res.writeHead(200).end("ok");
    if (req.method !== "POST" || url.pathname !== "/elevenlabs/webhook") return void res.writeHead(404).end();
    const event = await verifiedEvent(await readBody(req), req.headers["elevenlabs-signature"] as string | undefined, env.elevenlabs.webhookSecret());
    if (!event) return void res.writeHead(401).end();
    return handleElevenlabsEvent(db, event).then(
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
