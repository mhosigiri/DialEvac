import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "../src/voice";
import type { Contract } from "../src/contract";
import { inboundDemoChecks } from "../src/demo-readiness";
import { VOICE_SAFETY_RULES } from "../src/voice-safety";

test("readiness fails closed by default and reflects dependency loss without a restart", async t => {
  let connected = true;
  const servers = [createServer({} as Contract), createServer({} as Contract, { readiness: () => ({ ready: connected, checks: { database: connected } }) })];
  for (const server of servers) {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  }
  const urls = servers.map(server => { const addr = server.address(); assert(addr && typeof addr !== "string"); return `http://127.0.0.1:${addr.port}`; });
  assert.equal((await fetch(`${urls[0]}/health`)).status, 200);
  assert.equal((await fetch(`${urls[0]}/ready`)).status, 503);
  assert.equal((await fetch(`${urls[1]}/ready`)).status, 200);
  connected = false;
  const unavailable = await fetch(`${urls[1]}/ready`);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.deepEqual(await unavailable.json(), { ready: false, checks: { database: false } });
});

test("inbound preflight rejects stale safety rules, wrong target, disconnected receiver and incorrect webhook", () => {
  const ready = { capabilities: { database: "hackutd-richardson", uri: "wss://maincloud.spacetimedb.com", transcriptIngestion: true, claudeAnalysis: true, outboundEnabled: false },
    readiness: { ready: true, checks: { database: true, durableStorage: true, analysisConfigured: true, stopping: true } },
    prompt: VOICE_SAFETY_RULES, phoneAgentId: "agent-synthetic", agentId: "agent-synthetic", webhookId: "hook-synthetic", configuredWebhookId: "hook-synthetic", transcriptEnabled: true };
  assert(inboundDemoChecks(ready).every(c => c.ok));
  for (const patch of [
    { prompt: "old prompt" }, { capabilities: { ...ready.capabilities, database: "hackutd-535md" } },
    { readiness: { ready: true, checks: {} } }, { readiness: { ready: false } }, { webhookId: "wrong" }, { phoneAgentId: "wrong" },
  ]) assert(inboundDemoChecks({ ...ready, ...patch }).some(c => !c.ok));
});
