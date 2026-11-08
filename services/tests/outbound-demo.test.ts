import { test } from "node:test";
import assert from "node:assert/strict";
import { dialDemoAttempt, receiverCheck, sipCheck } from "../src/outbound-demo";

const phones = ["+12142003841", "+16822005303", "+14692004623"];
test("judge demo consumes its named attempt before dialing only the selected resident", async () => {
  const consumed = new Set<string>(), order: string[] = [];
  const options = { attemptId: "judges-01", allowlist: phones,
    startAttempt: async (id: string) => { if (consumed.has(id)) throw new Error("already consumed"); consumed.add(id); order.push("claim"); return { callId: 50n }; },
    failed: async () => { order.push("failed"); },
    dial: async (phone: string, variables: { call_id: string }, intro: string) => { assert.equal(phone, phones[1]); assert.equal(variables.call_id, "50"); assert.match(intro, /simulated/); order.push("dial"); return "conv_demo"; },
  };
  assert.deepEqual(await dialDemoAttempt(options), { callId: 50n, providerId: "conv_demo" });
  await assert.rejects(dialDemoAttempt(options), /already consumed/);
  assert.deepEqual(order, ["claim", "dial"]);
});

test("a dial failure is recorded without a retry, while an uncertain timeout retains the open call", async () => {
  let dials = 0, failures = 0;
  const options = { attemptId: "test-1", allowlist: phones, startAttempt: async () => ({ callId: 1n }), failed: async () => { failures++; },
    dial: async () => { dials++; throw new Error("provider rejected the call"); } };
  await assert.rejects(dialDemoAttempt(options), /rejected/);
  assert.equal(dials, 1); assert.equal(failures, 1);
  await assert.rejects(dialDemoAttempt({ ...options, dial: async () => { throw new Error("request timed out"); } }), /timed out/);
  assert.equal(failures, 1);
});

test("preflight rejects an operational receiver, a wrong trunk, wildcard contacts and fictional real-call targets", async () => {
  assert.equal(receiverCheck({ database: "hackutd-535md", uri: "wss://maincloud.spacetimedb.com", transcriptIngestion: true, claudeAnalysis: true }).ok, false);
  assert.equal(receiverCheck({ database: "hackutd-richardson", uri: "wss://maincloud.spacetimedb.com", transcriptIngestion: true, claudeAnalysis: true }).ok, true);
  assert.equal(sipCheck({ provider: "sip_trunk", phoneNumber: "line", outboundTrunk: { address: "wrong" } }, { phone: "line", server: "right", username: "user" }).ok, false);
  const base = { attemptId: "test", allowlist: phones, startAttempt: async () => { throw new Error("must not claim"); }, failed: async () => {}, dial: async () => "unused" };
  await assert.rejects(dialDemoAttempt({ ...base, allowlist: ["*", ...phones] }), /three/);
  await assert.rejects(dialDemoAttempt({ ...base, allowlist: ["+12145553841", "+16825555303", "+14695554623"] }), /real allowlisted/);
});
