import http from "node:http";
import { env, isFictional, mayContact } from "./env";
import { gatherTwiml, placeCall, sayTwiml, validSignature } from "./twilio";
import type { Contract } from "./contract";
import { KEYPAD_ASK, SURVEY_INTRO } from "../../spacetimedb/src/domain/script";

// The voice service. Places queued survey calls and pending callbacks over Twilio at a paced rate,
// and answers Twilio's webhooks. Survey calls take keypad answers; the conversational agent
// (Cartesia speech, Claude reading each turn) plugs in at /twilio/survey later. Fictional 555
// numbers are left for the stand-in voice in the module.
//
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

export function startRunners(db: Contract, enqueue: (priority: number, job: () => Promise<void>) => void) {
  const base = env.voice.publicUrl();
  db.onQueuedCall((call) => {
    const home = db.household(call.householdId);
    if (!home || isFictional(home.phone)) return;
    enqueue(call.priority, async () => {
      try {
        await db.claimCall(call.id, "twilio");
      } catch {
        return;
      }
      if (!mayContact(home.phone)) return db.callEnded(call.id, "not_allowed");
      await placeCall(home.phone, `${base}/twilio/survey?callId=${call.id}`, `${base}/twilio/status?callId=${call.id}`).catch((error: unknown) => {
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
      await placeCall(home.phone, `${base}/twilio/callback?callbackId=${callback.id}`, `${base}/twilio/status?callbackId=${callback.id}`).catch(
        (error: unknown) => {
          console.error("[voice] callback failed", error);
          return db.markCallback(callback.id, "unanswered");
        },
      );
    });
  });
}

async function readForm(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

function xml(res: http.ServerResponse, body: string) {
  res.writeHead(200, { "content-type": "text/xml" }).end(body);
}

export function createServer(db: Contract) {
  const base = () => env.voice.publicUrl();
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return void res.writeHead(200).end("ok");
    if (req.method !== "POST" || !url.pathname.startsWith("/twilio/")) return void res.writeHead(404).end();
    const form = await readForm(req);
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
  startRunners(db, queue.push);
  pace(queue, env.voice.callsPerSecond);
  createServer(db).listen(env.voice.port, () => console.log(`[voice] listening on :${env.voice.port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
