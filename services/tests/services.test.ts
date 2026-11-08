import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.CONTACT_ALLOWLIST = "+12142000100,+14692001234";
process.env.TWILIO_AUTH_TOKEN = "test-token";
process.env.TWILIO_VALIDATE_SIGNATURE = "true";

const { deliver } = await import("../src/messaging");
const { callParams, gatherTwiml, sayTwiml, validSignature } = await import("../src/twilio");
const { outcomeFor, handleElevenlabsEvent, startRunners } = await import("../src/voice");
const { surveyAnswer, verifiedEvent } = await import("../src/elevenlabs");
type Contract = import("../src/contract").Contract;

function fakeDb(phone: string) {
  const calls: string[] = [];
  const db = {
    household: () => ({ id: 1n, phone, language: "en", name: "Test" }),
    claimMessage: async () => void calls.push("claim"),
    messageSent: async (_id: bigint, providerId: string) => void calls.push(`sent:${providerId}`),
    messageFailed: async (_id: bigint, error: string) => void calls.push(`failed:${error}`),
  } as unknown as Contract;
  return { db, calls };
}

const row = { id: 7n, householdId: 1n, direction: "out", state: "queued", body: "hello" };

test("an allowlisted number is claimed, sent and marked sent", async () => {
  const { db, calls } = fakeDb("+14692001234");
  await deliver(db, row, async () => "imsg-1");
  assert.deepEqual(calls, ["claim", "sent:imsg-1"]);
});

test("a number off the allowlist is never sent to", async () => {
  const { db, calls } = fakeDb("+19725550000");
  let sent = false;
  await deliver(db, row, async () => ((sent = true), "x"));
  assert.equal(sent, false);
  assert.deepEqual(calls, ["claim", "failed:number not on CONTACT_ALLOWLIST"]);
});

test("a failed send is recorded as failed", async () => {
  const { db, calls } = fakeDb("+14692001234");
  await deliver(db, row, async () => {
    throw new Error("no iMessage");
  });
  assert.deepEqual(calls, ["claim", "failed:no iMessage"]);
});

test("Twilio signatures validate per Twilio's scheme and reject tampering", () => {
  const url = "https://voice.example.test/twilio/digit?callId=3";
  const params = new URLSearchParams({ Digits: "3", CallSid: "CA1" });
  const signature = createHmac("sha1", "test-token").update(`${url}CallSidCA1Digits3`).digest("base64");
  assert.equal(validSignature(url, params, signature), true);
  assert.equal(validSignature(url, new URLSearchParams({ Digits: "4", CallSid: "CA1" }), signature), false);
  assert.equal(validSignature(url, params, undefined), false);
});

test("TwiML escapes spoken text and gathers one digit", () => {
  assert.match(sayTwiml("Rosa & Ana <now>", "es"), /language="es-US">Rosa &#38; Ana &#60;now&#62;</);
  assert.match(gatherTwiml("Press 1", "https://x.test/d?callId=1&a=b", "en"), /numDigits="1".*action="https:\/\/x.test\/d\?callId=1&#38;a=b"/);
});

test("a completed human call counts as answered", () => {
  assert.equal(outcomeFor("completed", null), "answered");
  assert.equal(outcomeFor("completed", "machine_end_beep"), "voicemail");
  assert.equal(outcomeFor("no-answer", null), "no_answer");
});

test("the call queue places the most urgent call first, callbacks before any survey", async () => {
  const { callQueue } = await import("../src/voice");
  const queue = callQueue();
  const noop = async () => {};
  queue.push(12, noop);
  queue.push(310, noop);
  queue.push(Number.MAX_SAFE_INTEGER, noop);
  queue.push(140, noop);
  assert.deepEqual(queue.take(3).map((job) => job.priority), [Number.MAX_SAFE_INTEGER, 310, 140]);
  assert.deepEqual(queue.take(3).map((job) => job.priority), [12]);
});

test("calls dial through Photon SIP when it is configured, and the phone network when it is not", () => {
  const sipKeys = ["PHOTON_SIP_SERVER", "PHOTON_SIP_USERNAME", "PHOTON_SIP_PASSWORD"] as const;
  const saved = sipKeys.map((k) => process.env[k]);
  process.env.VOICE_FROM_NUMBER = "+12142000199";
  try {
    for (const k of sipKeys) delete process.env[k];
    const direct = callParams("+14692001234", "https://x/survey", "https://x/status");
    assert.equal(direct.get("To"), "+14692001234");
    assert.equal(direct.has("SipAuthUsername"), false);

    process.env.PHOTON_SIP_SERVER = "sip.photon.codes:5061";
    process.env.PHOTON_SIP_USERNAME = "user";
    process.env.PHOTON_SIP_PASSWORD = "pass";
    const sip = callParams("+14692001234", "https://x/survey", "https://x/status");
    assert.equal(sip.get("To"), "sip:+14692001234@sip.photon.codes:5061;transport=tls");
    assert.equal(sip.get("From"), "+12142000199");
    assert.equal(sip.get("SipAuthUsername"), "user");
    assert.equal(sip.get("SipAuthPassword"), "pass");
    assert.deepEqual(sip.getAll("StatusCallbackEvent"), ["completed", "answered"]);

    delete process.env.PHOTON_SIP_PASSWORD;
    assert.throws(() => callParams("+14692001234", "u", "s"), /or none/);
  } finally {
    sipKeys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  }
});


const sign = (body: string, secret: string, t: number) =>
  `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

test("ElevenLabs webhook signatures validate through the SDK, and tampered or stale ones are rejected", async () => {
  const t = Math.floor(Date.now() / 1000) - 60;
  const body = '{"type":"post_call_transcription","data":{"conversation_id":"c1"}}';
  assert.deepEqual(await verifiedEvent(body, sign(body, "s3cret", t), "s3cret"), JSON.parse(body));
  assert.equal(await verifiedEvent(body + " ", sign(body, "s3cret", t), "s3cret"), null);
  assert.equal(await verifiedEvent(body, sign(body, "other", t), "s3cret"), null);
  assert.equal(await verifiedEvent(body, sign(body, "s3cret", t - 3600), "s3cret"), null);
  assert.equal(await verifiedEvent(body, undefined, "s3cret"), null);
});

test("a spoken answer maps to the keypad's choices, and anything unclear is dropped", () => {
  assert.deepEqual(surveyAnswer({ choice: { value: "3" }, people: { value: 4 }, oxygen: { value: true } }), { choice: "3", people: 4, oxygen: true });
  assert.deepEqual(surveyAnswer({ choice: { value: "maybe" }, people: { value: 0 }, oxygen: { value: "yes" } }), {
    choice: null,
    people: undefined,
    oxygen: undefined,
  });
  assert.deepEqual(surveyAnswer(undefined), { choice: null, people: undefined, oxygen: undefined });
});

function voiceDb() {
  const log: string[] = [];
  const db = {
    call: (id: bigint) => ({ id, householdId: 9n, purpose: "survey", phase: "live", priority: 1 }),
    household: () => ({ id: 9n, phone: "+14692001234", language: "en", name: "Pat" }),
    onQueuedCall: (handler: (row: unknown) => void) => handler({ id: 5n, householdId: 9n, purpose: "survey", phase: "queued", priority: 3 }),
    onPendingCallback: () => undefined,
    claimCall: async (id: bigint, provider: string) => void log.push(`claim:${id}:${provider}`),
    updateRecord: async (_h: bigint, patch: object, source: string) => void log.push(`record:${JSON.stringify(patch)}:${source}`),
    recordDigit: async (id: bigint, digit: string) => void log.push(`digit:${id}:${digit}`),
    callEnded: async (id: bigint, outcome: string) => void log.push(`ended:${id}:${outcome}`),
    markCallback: async (id: bigint, state: string) => void log.push(`callback:${id}:${state}`),
    inboundCallEnded: async (phone: string, conversation: string, answer: object) => void log.push(`inbound:${phone}:${conversation}:${JSON.stringify(answer)}`),
  } as unknown as Contract;
  return { db, log };
}

const transcript = (variables: object, extra: object = {}) => ({
  type: "post_call_transcription",
  data: { conversation_id: "c1", conversation_initiation_client_data: { dynamic_variables: variables }, ...extra },
});

test("a finished ElevenLabs survey records the answer like a pressed key", async () => {
  const { db, log } = voiceDb();
  await handleElevenlabsEvent(db, transcript({ call_id: "5", callback_id: "" }, { analysis: { data_collection_results: { choice: { value: "2" }, people: { value: 3 } } } }));
  assert.deepEqual(log, ['record:{"people":3}:voice', "digit:5:2"]);
});

test("a survey with no clear answer is not counted as reached, so the ladder tries again", async () => {
  const { db, log } = voiceDb();
  await handleElevenlabsEvent(db, transcript({ call_id: "5" }, { analysis: { data_collection_results: { people: { value: 2 } } } }));
  await handleElevenlabsEvent(db, transcript({ call_id: "5" }, { metadata: { termination_reason: "Voicemail detected" } }));
  assert.deepEqual(log, ["ended:5:answered", "ended:5:voicemail"]);
});

test("a resident who calls in is matched by their number, and their answer goes with it", async () => {
  const { db, log } = voiceDb();
  const results = { choice: { value: "3" }, people: { value: 2 }, oxygen: { value: true } };
  await handleElevenlabsEvent(db, transcript({ system__caller_id: "+14692001234" }, { analysis: { data_collection_results: results } }));
  await handleElevenlabsEvent(db, transcript({ system__caller_id: "+14692001234" }));
  await handleElevenlabsEvent(db, transcript({}, { analysis: { data_collection_results: results } }));
  assert.deepEqual(log, [
    'inbound:+14692001234:c1:{"choice":"3","people":2,"oxygen":true}',
    'inbound:+14692001234:c1:{"choice":""}',
  ]);
});

test("failed ElevenLabs calls and callbacks report how they ended", async () => {
  const { db, log } = voiceDb();
  const failure = (variables: object, failure_reason: string) => ({
    type: "call_initiation_failure",
    data: { conversation_id: "c2", failure_reason, conversation_initiation_client_data: { dynamic_variables: variables } },
  });
  await handleElevenlabsEvent(db, failure({ call_id: "5" }, "no-answer"));
  await handleElevenlabsEvent(db, failure({ call_id: "5" }, "busy"));
  await handleElevenlabsEvent(db, failure({ callback_id: "7" }, "unknown"));
  await handleElevenlabsEvent(db, transcript({ callback_id: "7" }));
  await handleElevenlabsEvent(db, { type: "post_call_audio", data: {} });
  assert.deepEqual(log, ["ended:5:no_answer", "ended:5:busy", "callback:7:unanswered", "callback:7:played"]);
});

test("a queued call is claimed and dialed, and a failed dial is recorded", async () => {
  const { db, log } = voiceDb();
  const jobs: (() => Promise<void>)[] = [];
  const dialed: string[] = [];
  startRunners(db, (_p, job) => void jobs.push(job), {
    survey: async (call, home) => void dialed.push(`${call.id}->${home.phone}`),
    callback: async () => undefined,
  });
  await jobs[0]();
  assert.deepEqual(dialed, ["5->+14692001234"]);
  startRunners(db, (_p, job) => void jobs.push(job), {
    survey: async () => Promise.reject(new Error("trunk down")),
    callback: async () => undefined,
  });
  await jobs[1]();
  assert.deepEqual(log, ["claim:5:elevenlabs", "claim:5:elevenlabs", "ended:5:failed"]);
});
