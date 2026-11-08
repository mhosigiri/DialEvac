import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { normalizeConversation, conversationFromWebhook } from "../src/call-ingestion";
import { spoolConversation, drainSpool } from "../src/call-spool";
import { analyzeTranscript } from "../src/claude-analysis";
import { createServer } from "../src/voice";
import type { Contract } from "../src/contract";

test("normalizes provider turns and preserves unknown callers instead of discarding their conversation", () => {
  const call = { conversationId: "conv_test", agentId: "agent-test", status: "done", metadata: { startTimeUnixSecs: 123, callDurationSecs: 90, phoneCall: { direction: "inbound" } },
    transcript: [{ role: "user", message: "Need assistance" }, { role: "agent", message: null }, { role: "agent", message: "Where are you?" }],
    conversationInitiationClientData: { dynamicVariables: { system__caller_id: "+12145550100", call_id: "18446744073709551616" } } } as unknown as ElevenLabs.GetConversationResponseModel;
  const row = normalizeConversation(call, () => undefined);
  assert.equal(row.householdId, undefined);
  assert.equal(row.callId, undefined);
  assert.equal(row.callerLabel, "Caller ending 0100");
  assert.deepEqual(row.turns, [{ speaker: "resident", text: "Need assistance" }, { speaker: "agent", text: "Where are you?" }]);
  assert.equal(normalizeConversation(call, () => 42n).householdId, 42n);
});

test("durable spool retries failed jobs, retains payloads, and continues processing other conversations", async t => {
  const dir = await mkdtemp(join(tmpdir(), "call-spool-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await spoolConversation(dir, "conv_failed", { transcript: "private recorded payload" });
  await spoolConversation(dir, "conv_ready");
  let ready = 0;
  const failures = await drainSpool(dir, async id => { if (id === "conv_failed") throw new Error("db down"); ready++; });
  assert.equal(failures, 1);
  assert.equal(ready, 1);
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  assert.match(await readFile(join(dir, files[0]), "utf8"), /private recorded payload/);
  await drainSpool(dir, async () => {});
  assert.deepEqual(await readdir(dir), []);
});

test("provider outage can recover the transcript from the verified private webhook payload", () => {
  const event = { type: "post_call_transcription", data: { agent_id: "agent-test", conversation_id: "conv_saved", metadata: { start_time_unix_secs: 100, call_duration_secs: 20 },
    conversation_initiation_client_data: { dynamic_variables: { system__caller_id: "+12145550100" } }, transcript: [{ role: "agent", message: "Where are you?" }, { role: "user", message: "At home." }] } };
  const saved = conversationFromWebhook(event, "agent-test"); assert(saved);
  assert.deepEqual(normalizeConversation(saved, () => undefined).turns, [{ speaker: "agent", text: "Where are you?" }, { speaker: "resident", text: "At home." }]);
  assert.equal(conversationFromWebhook(event, "other-agent"), undefined);
});

test("Claude uses constrained JSON and rejects hallucinated evidence and truncated responses", async t => {
  const previous = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = "mock-test-key";
  t.after(() => { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous; });
  const turns = [{ speaker: "resident", text: "I need a wheelchair." }];
  const result = { summary: "Caller reports a wheelchair need.", priority: "high", priorityReason: "Reported mobility assistance.", facts: [{ fact: "Wheelchair need", turn: 0, quote: "I need a wheelchair." }], unknowns: ["Address"], recommendedActions: ["Confirm address"] };
  let request: Record<string, unknown> | undefined;
  const fake = (payload: unknown) => (async (_url, options) => { request = JSON.parse(String(options?.body)); return new Response(JSON.stringify(payload)); }) as typeof fetch;
  const body = { stop_reason: "end_turn", model: "claude-test", content: [{ type: "text", text: JSON.stringify(result) }] };
  assert.deepEqual((await analyzeTranscript(turns, fake(body))).result, result);
  assert.equal((request?.output_config as { format: { type: string } }).format.type, "json_schema");
  await assert.rejects(analyzeTranscript(turns, fake({ ...body, stop_reason: "max_tokens" })), /did not finish/);
  await assert.rejects(analyzeTranscript(turns, fake({ ...body, content: [{ type: "text", text: JSON.stringify({ ...result, facts: [{ fact: "bad", turn: 0, quote: "invented" }] }) }] })), /evidence/);
});

test("webhook returns 200 after durable enqueue without waiting for database or Claude; enqueue failure returns 500", async t => {
  const previous = process.env.ELEVENLABS_WEBHOOK_SECRET; process.env.ELEVENLABS_WEBHOOK_SECRET = "ingest-test-secret";
  t.after(() => { if (previous === undefined) delete process.env.ELEVENLABS_WEBHOOK_SECRET; else process.env.ELEVENLABS_WEBHOOK_SECRET = previous; });
  let queued = 0, fail = false;
  const server = createServer({ target: { uri: "test", database: "demo" } } as Contract, { onWebhook: async () => { if (fail) throw new Error("spool unavailable"); queued++; } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address !== "string");
  const body = JSON.stringify({ type: "post_call_transcription", data: { conversation_id: "conv_test" } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `t=${timestamp},v0=${createHmac("sha256", "ingest-test-secret").update(`${timestamp}.${body}`).digest("hex")}`;
  const send = (signed = true) => fetch(`http://127.0.0.1:${address.port}/elevenlabs/webhook`, { method: "POST", body, headers: signed ? { "elevenlabs-signature": signature } : {} });
  assert.equal((await send(false)).status, 401);
  assert.equal(queued, 0);
  assert.equal((await send()).status, 200);
  assert.equal(queued, 1);
  fail = true;
  assert.equal((await send()).status, 500);
});
