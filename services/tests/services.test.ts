import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.CONTACT_ALLOWLIST = "+12142000100,+14692001234";

const { deliver, perResident, pollReplies } = await import("../src/messaging");
const { PhotonError, photonClient, textsFrom } = await import("../src/photon");
const { handleElevenlabsEvent, startRunners } = await import("../src/voice");
const { surveyAnswer, verifiedEvent } = await import("../src/elevenlabs");
type Contract = import("../src/contract").Contract;

function fakeDb(phone: string) {
  const calls: string[] = [];
  const db = {
    household: () => ({ id: 1n, phone, language: "en", name: "Test" }),
    claimMessage: async () => void calls.push("claim"),
    messageSent: async (_id: bigint, providerId: string) => void calls.push(`sent:${providerId}`),
    messageFailed: async (_id: bigint, error: string) => void calls.push(`failed:${error}`),
    messageWaiting: async () => void calls.push("waiting"),
  } as unknown as Contract;
  return { db, calls };
}

const row = { id: 7n, householdId: 1n, direction: "out", state: "queued", body: "hello" };

test("an allowlisted number is claimed, sent once per row and marked sent", async () => {
  const { db, calls } = fakeDb("+14692001234");
  let key = "";
  await deliver(db, row, async (_phone, _body, idempotencyKey) => ((key = idempotencyKey), "imsg-1"));
  assert.deepEqual(calls, ["claim", "sent:imsg-1"]);
  assert.equal(key, "hackutd-message-7");
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

test("a text Photon refuses until the resident writes first waits instead of failing", async () => {
  const { db, calls } = fakeDb("+14692001234");
  await deliver(db, row, async () => {
    throw new PhotonError(403, "SHARED_LINE_INBOUND_REQUIRED", "The recipient must message this shared line before it can reply");
  });
  assert.deepEqual(calls, ["claim", "waiting"]);
});

test("one resident's texts go out in queue order while other residents' send alongside", async () => {
  const order: string[] = [];
  const gates = new Map<string, () => void>();
  const send = perResident(async (r) => {
    order.push(`start:${r.body}`);
    await new Promise<void>((resolve) => gates.set(r.body, resolve));
    order.push(`end:${r.body}`);
  });
  const ask = send({ ...row, id: 1n, householdId: 1n, body: "ask" });
  const status = send({ ...row, id: 2n, householdId: 1n, body: "status" });
  const other = send({ ...row, id: 3n, householdId: 2n, body: "other" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["start:ask", "start:other"]);
  gates.get("ask")!();
  await ask;
  await new Promise((resolve) => setImmediate(resolve));
  gates.get("status")!();
  gates.get("other")!();
  await Promise.all([status, other]);
  assert.deepEqual(order, ["start:ask", "start:other", "end:ask", "start:status", "end:status", "end:other"]);
});

test("replies are polled with an overlap, recorded once, and retried if the module refuses one", async () => {
  const received: string[] = [];
  let refuse = true;
  const db = {
    receiveMessage: async (phone: string, body: string, id: string) => {
      if (id === "m2" && refuse) throw new Error("db busy");
      received.push(`${phone}:${body}:${id}`);
    },
  } as unknown as Contract;
  const texts = [
    { id: "m1", from: "+14692001234", text: "3", createdAt: "2026-11-08T07:40:00.000Z" },
    { id: "m2", from: "+14692001234", text: "hi", createdAt: "2026-11-08T07:41:00.000Z" },
  ];
  const cursor = { since: "2026-11-08T07:30:00.000Z" };
  const seen = new Set<string>();
  await assert.rejects(pollReplies(db, async () => texts, cursor, seen), /db busy/);
  assert.deepEqual(received, ["+14692001234:3:m1"]);
  refuse = false;
  await pollReplies(db, async () => texts, cursor, seen);
  await pollReplies(db, async () => texts, cursor, seen);
  assert.deepEqual(received, ["+14692001234:3:m1", "+14692001234:hi:m2"]);
  assert.equal(cursor.since, "2026-11-08T07:40:00.000Z");
});

test("only text from people counts as a reply", () => {
  const base = { createdAt: "2026-11-08T07:40:00.000Z" };
  const texts = textsFrom([
    { ...base, id: "a", sentBy: { handle: "+14692001234", kind: "human" }, content: { type: "text", text: "2" } },
    { ...base, id: "b", sentBy: { handle: "+16283166196", kind: "agent" }, content: { type: "text", text: "echo" } },
    { ...base, id: "c", sentBy: { handle: "+14692001234", kind: "human" }, content: { type: "message.read" } },
  ]);
  assert.deepEqual(texts, [{ id: "a", from: "+14692001234", text: "2", createdAt: base.createdAt }]);
});

test("a Photon send assigns the shared line once, then reuses the space", async () => {
  const requests: string[] = [];
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status });
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/v1\/projects\/pho_prj_x/, "");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push(`${init.method} ${path}${init.headers && (init.headers as Record<string, string>)["idempotency-key"] ? ` key=${(init.headers as Record<string, string>)["idempotency-key"]}` : ""}`);
    if (path === "/platforms/imessage/assignments" && init.method === "GET") return reply(200, { assignments: [] });
    if (path === "/platforms/imessage/assignments") return reply(201, { assignedPhoneNumber: "+16283166196" });
    if (path === "/users") return reply(200, { id: body.handle === "+16283166196" ? "agent" : "resident" });
    if (path === "/spaces") return reply(201, { id: `space:${body.participantIds.join(",")}` });
    if (path === "/messages" && body.content.text === "too soon") return reply(403, { code: "SHARED_LINE_INBOUND_REQUIRED", detail: "The recipient must message this shared line before it can reply" });
    if (path === "/messages") return reply(202, { id: `msg:${body.spaceId}:${body.senderId}:${body.content.format}` });
    return reply(404, {});
  }) as typeof fetch;
  const photon = photonClient("pho_prj_x", "secret", fakeFetch);
  assert.equal(await photon.sendText("+14692001234", "hello", "k1"), "msg:space:agent,resident:agent:plain");
  await assert.rejects(photon.sendText("+14692001234", "too soon", "k2"), /Photon 403 SHARED_LINE_INBOUND_REQUIRED/);
  assert.deepEqual([...requests].sort(), [
    "GET /platforms/imessage/assignments",
    "POST /platforms/imessage/assignments key=assign-+14692001234",
    "POST /users",
    "POST /users",
    "POST /spaces key=space-agent-resident",
    "POST /messages key=k1",
    "POST /messages key=k2",
  ].sort());
});

test("reading replies follows Photon's pages to the end", async () => {
  const text = (id: string) => ({ id, createdAt: "2026-11-08T07:40:00.000Z", sentBy: { handle: "+14692001234", kind: "human" }, content: { type: "text", text: id } });
  const fakeFetch = (async (url: string) => {
    const page = new URL(url).searchParams.get("pageToken");
    const body = page ? { items: [text("m2")] } : { items: [text("m1")], nextPageToken: "p2" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const texts = await photonClient("pho_prj_x", "secret", fakeFetch).receivedSince("2026-11-08T07:00:00.000Z");
  assert.deepEqual(texts.map((t) => t.text), ["m1", "m2"]);
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

test("the normal voice runner never claims a fictional Houston survey or places its callback", () => {
  const { db, log } = voiceDb();
  db.household = () => ({ id: 9n, phone: "+17135550100", language: "en", name: "Synthetic Houston resident" });
  db.onPendingCallback = handler => handler({ id: 7n, householdId: 9n, line: "Synthetic notice", state: "pending" } as Parameters<typeof handler>[0]);
  let queued = 0, dialed = 0;
  startRunners(db, () => { queued++; }, { survey: async () => { dialed++; }, callback: async () => { dialed++; } });
  assert.equal(queued, 0); assert.equal(dialed, 0); assert.deepEqual(log, []);
});
