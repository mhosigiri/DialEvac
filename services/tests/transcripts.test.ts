import { test } from "node:test";
import assert from "node:assert/strict";
import { handleElevenlabsEvent } from "../src/voice";
import type { Contract } from "../src/contract";

function fixture() {
  const writes: unknown[] = [], order: string[] = [];
  const db = {
    call: () => undefined,
    inboundCallEnded: async () => void order.push("inbound"),
    callEnded: async () => void order.push("ended"),
    markCallback: async () => void order.push("callback"),
    recordCallTranscript: async (input: unknown) => { order.push("transcript"); writes.push(input); },
  } as unknown as Contract;
  return { db, writes, order };
}
function event(variables: object) {
  return { type: "post_call_transcription", data: { conversation_id: "conv-test",
    conversation_initiation_client_data: { dynamic_variables: variables }, transcript: [
      { role: "agent", message: "Can you leave?", time_in_call_secs: 0 },
      { role: "user", message: "I need a ride.", time_in_call_secs: 2 },
      { role: "user", message: "I need a ride.", time_in_call_secs: 3 },
      { role: "agent", message: null }, { role: "user", message: "  " }, { role: "tool", message: "not a spoken turn" },
    ] } };
}
const turns = [{ speaker: "agent", text: "Can you leave?" }, { speaker: "resident", text: "I need a ride." }, { speaker: "resident", text: "I need a ride." }];

test("outbound webhook forwards spoken turns with the conversation key and exact portal speaker values", async () => {
  const { db, writes, order } = fixture();
  await handleElevenlabsEvent(db, event({ call_id: "5" }));
  assert.deepEqual(writes, [{ providerId: "conv-test", callId: 5n, turns }]);
  assert.deepEqual(order, ["transcript", "ended"]);
});

test("inbound webhook records the call before linking its transcript by conversation and caller", async () => {
  const { db, writes, order } = fixture();
  await handleElevenlabsEvent(db, event({ system__caller_id: "+12145550100" }));
  assert.deepEqual(order, ["inbound", "transcript"]);
  assert.deepEqual(writes, [{ providerId: "conv-test", phone: "+12145550100", turns }]);
});

test("callback webhooks persist spoken turns before marking playback complete", async () => {
  const { db, writes, order } = fixture();
  await handleElevenlabsEvent(db, event({ callback_id: "7" }));
  assert.deepEqual(order, ["transcript", "callback"]);
  assert.deepEqual(writes, [{ providerId: "conv-test", callbackId: 7n, turns }]);
});

test("transcript write failure remains retryable and repeats the identical conversation key", async () => {
  const { db, writes } = fixture();
  const ingest = (db as unknown as { recordCallTranscript: (input: unknown) => Promise<void> }).recordCallTranscript;
  let fail = true;
  (db as unknown as { recordCallTranscript: (input: unknown) => Promise<void> }).recordCallTranscript = async input => {
    await ingest(input);
    if (fail) throw new Error("database unavailable");
  };
  await assert.rejects(handleElevenlabsEvent(db, event({ call_id: "5" })), /database unavailable/);
  fail = false;
  await handleElevenlabsEvent(db, event({ call_id: "5" }));
  assert.deepEqual(writes[0], writes[1]);
});
