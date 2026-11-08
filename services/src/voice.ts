import http from "node:http";
import { env, isFictional, mayContact } from "./env";
import { gatherTwiml, placeCall, sayTwiml, validSignature } from "./twilio";
import { endedOn, failureOutcome, outboundCall, surveyAnswer, verifiedEvent, type WebhookEvent } from "./elevenlabs";
import type { CallbackRow, CallRow, Contract, HouseholdRow } from "./contract";
import { KEYPAD_ASK, SURVEY_INTRO } from "../../spacetimedb/src/domain/script";

// The voice service. Places queued survey calls and pending callbacks at a paced rate from the
// Photon number, through an ElevenLabs agent (default) or Twilio, and takes each one's result back
// by webhook. Fictional 555 numbers are left for the stand-in voice in the module.
//
//   POST /elevenlabs/webhook           a finished or failed ElevenLabs call
//   POST /twilio/survey?callId=        TwiML: the survey question, keypad answer
//   POST /twilio/digit?callId=         the keypad answer
//   POST /twilio/callback?callbackId=  TwiML: the templated status line
//   POST /twilio/status?callId= | ?callbackId=   how the call ended
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

const ENDED = new Set(["completed", "no-answer", "busy", "failed", "canceled"]);

// "answered" is the outcome the module counts as reaching the home.
export function outcomeFor(callStatus: string, answeredBy: string | null) {
  if (callStatus === "completed") return answeredBy?.startsWith("machine") ? "voicemail" : "answered";
  return callStatus.replace("-", "_");
}

// How a call is placed. Twilio and ElevenLabs both dial out over the Photon line; they differ in
// who holds the conversation and how the result comes back (see createServer's two webhook paths).
export type Dialer = {
  survey(call: CallRow, home: HouseholdRow): Promise<void>;
  callback(callback: CallbackRow, home: HouseholdRow): Promise<void>;
};

function twilioDialer(): Dialer {
  const base = env.voice.publicUrl();
  return {
    survey: (call, home) => placeCall(home.phone, `${base}/twilio/survey?callId=${call.id}`, `${base}/twilio/status?callId=${call.id}`).then(() => undefined),
    callback: (cb, home) => placeCall(home.phone, `${base}/twilio/callback?callbackId=${cb.id}`, `${base}/twilio/status?callbackId=${cb.id}`).then(() => undefined),
  };
}

function elevenlabsDialer(): Dialer {
  return {
    survey: (call, home) => outboundCall(home.phone, { kind: "survey", call_id: String(call.id), callback_id: "", name: home.name }).then(() => undefined),
    callback: (cb, home) =>
      outboundCall(home.phone, { kind: "callback", call_id: "", callback_id: String(cb.id), name: home.name }, cb.line).then(() => undefined),
  };
}

export const dialerFor = (provider: "twilio" | "elevenlabs") => (provider === "twilio" ? twilioDialer() : elevenlabsDialer());

export function startRunners(db: Contract, enqueue: (priority: number, job: () => Promise<void>) => void, dialer: Dialer) {
  db.onQueuedCall((call) => {
    const home = db.household(call.householdId);
    if (!home || isFictional(home.phone)) return;
    enqueue(call.priority, async () => {
      try {
        await db.claimCall(call.id, env.voice.provider());
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

function xml(res: http.ServerResponse, body: string) {
  res.writeHead(200, { "content-type": "text/xml" }).end(body);
}

export function createServer(db: Contract) {
  const base = () => env.voice.publicUrl();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return void res.writeHead(200).end("ok");
    if (req.method === "POST" && url.pathname === "/elevenlabs/webhook") {
      const event = await verifiedEvent(await readBody(req), req.headers["elevenlabs-signature"] as string | undefined, env.elevenlabs.webhookSecret());
      if (!event) return void res.writeHead(401).end();
      return handleElevenlabsEvent(db, event).then(
        () => void res.writeHead(200).end(),
        (error: unknown) => {
          console.error("[voice] ElevenLabs webhook failed", error);
          res.writeHead(500).end();
        },
      );
    }
    if (req.method !== "POST" || !url.pathname.startsWith("/twilio/")) return void res.writeHead(404).end();
    const form = new URLSearchParams(await readBody(req));
    if (!validSignature(`${base()}${url.pathname}${url.search}`, form, req.headers["x-twilio-signature"] as string | undefined)) {
      return void res.writeHead(403).end();
    }
    const callId = url.searchParams.get("callId");
    const callbackId = url.searchParams.get("callbackId");
    try {
      if (url.pathname === "/twilio/survey" && callId) {
        await db.callAnswered(BigInt(callId)).catch(() => undefined);
        return xml(res, gatherTwiml(`${SURVEY_INTRO} ${KEYPAD_ASK}`, `${base()}/twilio/digit?callId=${callId}`, "en"));
      }
      if (url.pathname === "/twilio/digit" && callId) {
        await db.recordDigit(BigInt(callId), form.get("Digits") ?? "");
        return xml(res, sayTwiml("Thank you. We've recorded your answer. If you can leave safely, leave now.", "en"));
      }
      if (url.pathname === "/twilio/callback" && callbackId) {
        const callback = db.callback(BigInt(callbackId));
        if (!callback) return void res.writeHead(404).end();
        const home = db.household(callback.householdId);
        await db.markCallback(callback.id, "played");
        return xml(res, sayTwiml(callback.line, home?.language ?? "en"));
      }
      if (url.pathname === "/twilio/status") {
        const status = form.get("CallStatus") ?? "";
        if (ENDED.has(status) && callId) await db.callEnded(BigInt(callId), outcomeFor(status, form.get("AnsweredBy")));
        if (ENDED.has(status) && status !== "completed" && callbackId) await db.markCallback(BigInt(callbackId), "unanswered");
        return void res.writeHead(204).end();
      }
      res.writeHead(404).end();
    } catch (error) {
      console.error("[voice] webhook failed", error);
      res.writeHead(500).end();
    }
  });
}

async function main() {
  const { connect } = await import("./db"); // generated bindings load only when the service runs
  const db = await connect();
  const queue = callQueue();
  startRunners(db, queue.push, dialerFor(env.voice.provider()));
  pace(queue, env.voice.callsPerSecond);
  createServer(db).listen(env.voice.port, () => console.log(`[voice] listening on :${env.voice.port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
