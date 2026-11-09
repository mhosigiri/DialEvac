import { test } from "node:test";
import { once } from "node:events";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutreachStore, createOutreachCampaign, outreachContacts, parseLaunch } from "../src/twilio-outreach";
import { recordLiveAssessment } from "../src/live-assessment";
import { assessmentToken } from "../src/live-assessment";
import { guardedCompletion, voiceGuardContext, validGuardContext } from "../src/voice-guard";
import type { Contract } from "../src/contract";
import { SPEECH } from "../../spacetimedb/src/domain/honesty";

const phones = ["+12142000001", "+12142000002", "+12142000003"];
const request = { batchId: "campaign-123", category: "flood" };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "outreach-test-"));
  const path = join(directory, "outreach.sqlite");
  const store = new OutreachStore(path);
  return { store, path, cleanup: () => { store.db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("launch dials all three contacts concurrently and duplicate clicks reuse the same durable receipt", async t => {
  const { store, cleanup } = fixture(); t.after(cleanup);
  const started: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const campaign = createOutreachCampaign(store, { contacts: () => phones, preflight: async () => {}, dial: async (phone, variables) => {
    started.push(phone); assert.equal(variables.incident_category, "flood"); assert.match(variables.call_id, /^\d+$/); assert.equal(variables.household_id, variables.call_id);
    await held; return `conversation-${phone.slice(-4)}`;
  } });
  const first = campaign.launch(request);
  const second = campaign.launch(request);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, phones);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(a.contacts.length, 3);
  assert.ok(a.contacts.every(contact => contact.phase === "ringing"));
  await campaign.launch(request);
  assert.equal(started.length, 3);
  await assert.rejects(campaign.launch({ ...request, batchId: "other-batch" }), /active/);
  for (const phone of phones) assert.ok(!JSON.stringify(a).includes(phone));
});

test("a failed preflight makes no calls; uncertain submissions are persisted and never automatically redialed", async t => {
  const { store, cleanup } = fixture(); t.after(cleanup);
  let calls = 0;
  const denied = createOutreachCampaign(store, { contacts: () => phones, preflight: async () => { throw new Error("guard unavailable"); }, dial: async () => { calls++; return "unused"; } });
  await assert.rejects(denied.launch(request), /guard/);
  assert.equal(calls, 0);
  assert.equal(store.latest(), undefined);
  const campaign = createOutreachCampaign(store, { contacts: () => phones, preflight: async () => {}, dial: async () => { calls++; throw new Error("network timeout"); } });
  const receipt = await campaign.launch(request);
  assert.ok(receipt.contacts.every(contact => contact.phase === "uncertain"));
  await campaign.launch(request);
  assert.equal(calls, 3);
  await assert.rejects(campaign.launch({ ...request, batchId: "retry-12345" }), /active/);
});

test("persisted reservations become uncertain after a restart", () => {
  const { store, path, cleanup } = fixture();
  store.reserve(request.batchId, "flood", phones);
  store.db.close();
  const reopened = new OutreachStore(path);
  assert.ok(reopened.latest()?.contacts.every(contact => contact.phase === "uncertain"));
  reopened.db.close();
  rmSync(join(path, ".."), { recursive: true, force: true });
});

test("local assessments use the same call-bound authentication and only durable answers unlock recorded speech", async t => {
  const { store, cleanup } = fixture(); t.after(cleanup);
  const receipt = store.reserve(request.batchId, "flood", phones);
  const id = BigInt(receipt.contacts[0].callId);
  store.submitted(id, "conversation-1");
  const db = store.withContract({} as Contract);
  const body = { call_id: String(id), conversation_id: "conversation-1", choice: "3", people: 2, oxygen: true };
  const secret = "call-signing-secret";
  assert.equal(await recordLiveAssessment(db, secret, undefined, body), 401);
  assert.equal(db.residentState?.(id)?.assessmentRecorded, false);
  assert.equal(await recordLiveAssessment(db, secret, assessmentToken(secret, id), body), 200);
  assert.equal(db.residentState?.(id)?.assessmentRecorded, true);
  assert.equal(db.residentState?.(id)?.requestStatus, "received");
  assert.equal(db.residentState?.(id)?.ride, null);
  const context = voiceGuardContext(secret, { kind: "survey", call_id: String(id), callback_id: "", household_id: String(id) });
  const turn = await guardedCompletion(db, { messages: [{ role: "user", content: "Is help coming?" }], elevenlabs_extra_body: { guard_context: context } }, secret, async () => ({ content: "Your ambulance is on the way." }));
  assert.equal(turn.blocked, true);
  assert.match(turn.content ?? "", /No driver has accepted yet/);
  store.speech({ messages: [{ role: "user", content: "I use oxygen." }], elevenlabs_extra_body: { guard_context: context } }, SPEECH.oxygen);
  assert.equal(store.latest()?.contacts[0].turns.length, 2);
});

test("only exactly three real allowlisted destinations and a supported category are accepted", () => {
  assert.deepEqual(outreachContacts(phones, "+12142009999"), phones);
  for (const contacts of [["*", ...phones], phones.slice(0, 2), [phones[0], phones[0], phones[1]], ["+12145550001", phones[1], phones[2]], ["bad", phones[1], phones[2]]]) assert.throws(() => outreachContacts(contacts, "+12142009999"));
  assert.throws(() => outreachContacts(phones, phones[0]));
  assert.throws(() => parseLaunch({ ...request, category: "anything" }));
  assert.throws(() => parseLaunch({ ...request, phones }));
});

test("launch HTTP endpoint requires a private token and rejects foreign origins before invoking dialing", async t => {
  const { createServer } = await import("../src/voice");
  const token = "a".repeat(64);
  let launches = 0;
  const server = createServer({} as Contract, { outreach: { token: () => token, status: () => undefined, launch: async input => { launches++; return parseLaunch(input); } } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/outreach/launch`;
  const headers = { "content-type": "application/json", "x-outreach-request": "launch", "x-outreach-token": token };
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, origin: "https://unrelated.example" }, body: JSON.stringify(request) })).status, 403);
  assert.equal(launches, 0);
  assert.equal((await fetch(url, { method: "POST", headers: { ...headers, origin: "http://localhost:3001" }, body: JSON.stringify(request) })).status, 200);
  assert.equal(launches, 1);
});


test("signed incident context survives provider root encoding; category tampering is rejected", async t => {
  const { store, cleanup } = fixture(); t.after(cleanup);
  const batch = store.reserve("root-context-123", "wildfire", phones);
  const id = batch.contacts[0].callId;
  const secret = "context-signing-secret";
  const context = voiceGuardContext(secret, { kind: "survey", call_id: id, callback_id: "", household_id: id, incident_category: "wildfire" });
  assert.equal(validGuardContext(secret, context)?.incident_category, "wildfire");
  assert.equal(validGuardContext(secret, { ...context, incident_category: "flood" }), undefined);
  const turn = await guardedCompletion(store.withContract({} as Contract), { guard_context: context, messages: [{ role: "user", content: "How many people?" }] }, secret, async () => ({ content: SPEECH.people }));
  assert.equal(turn.blocked, false);
});


test("saving an assessment speaks an approved acknowledgement before the tool result", async t => {
  const { store, cleanup } = fixture(); t.after(cleanup);
  const batch = store.reserve("acknowledge-123", "flood", phones);
  const id = batch.contacts[0].callId;
  const secret = "acknowledgement-secret";
  const context = voiceGuardContext(secret, { kind: "survey", call_id: id, callback_id: "", household_id: id });
  const result = await guardedCompletion(store.withContract({} as Contract), {
    guard_context: context, messages: [{ role: "user", content: "Yes" }],
    tools: [{ type: "function", function: { name: "record_assessment" } }],
  }, secret, async () => ({ tool_calls: [{ type: "function", id: "save", function: { name: "record_assessment", arguments: JSON.stringify({ conversation_id: "test", choice: "1" }) } }] }));
  assert.equal(result.content, SPEECH.checking);
  assert.ok(!result.content.includes("recorded"));
  assert.equal(result.tool_calls?.length, 1);
});


test("audio checks receive an immediate approved response without waiting for the upstream model", async t => {
  const { store, cleanup } = fixture(); t.after(cleanup);
  const batch = store.reserve("audio-check-123", "flood", phones);
  const id = batch.contacts[0].callId;
  const secret = "audio-check-secret";
  const context = voiceGuardContext(secret, { kind: "survey", call_id: id, callback_id: "", household_id: id });
  for (const text of ["Hello? Hello? Hello?", "Can you hear me?", "Are you there?"]) {
    const turn = await guardedCompletion(store.withContract({} as Contract), { guard_context: context, messages: [{ role: "user", content: text }] }, secret, async () => { throw new Error("Must not wait for a model"); });
    assert.equal(turn.content, SPEECH.hearing);
    assert.equal(turn.blocked, false);
  }
});
