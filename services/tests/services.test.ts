import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.CONTACT_ALLOWLIST = "+12142000100,+14692001234";
process.env.TWILIO_AUTH_TOKEN = "test-token";
process.env.TWILIO_VALIDATE_SIGNATURE = "true";

const { deliver } = await import("../src/messaging");
const { gatherTwiml, sayTwiml, validSignature } = await import("../src/twilio");
const { outcomeFor } = await import("../src/voice");
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
