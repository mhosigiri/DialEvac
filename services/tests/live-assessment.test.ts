import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { assessmentToken, recordLiveAssessment } from "../src/live-assessment";
import { demoAgentConfig, demoContacts } from "../src/demo-handoff";
import { createServer } from "../src/voice";
import type { Contract, LiveAssessment } from "../src/contract";
import { env } from "../src/env";
import { handleElevenlabsEvent } from "../src/voice";

function fixture() {
  const recorded: LiveAssessment[] = [];
  const db = { call: () => ({ id: 5n, householdId: 9n, purpose: "survey", phase: "live", priority: 1 }),
    recordCallAssessment: async (answer: LiveAssessment) => void recorded.push(answer) } as unknown as Contract;
  const body = { call_id: "5", conversation_id: "conv-demo", choice: "3", people: 2, oxygen: true };
  return { db, recorded, body };
}

test("live assessment requires a valid call-bound secret before writing any answers", async () => {
  const { db, recorded, body } = fixture();
  const secret = "test-only-secret", token = assessmentToken(secret, 5n);
  assert.equal(await recordLiveAssessment(db, secret, undefined, body), 401);
  assert.equal(await recordLiveAssessment(db, secret, token, { ...body, call_id: "6" }), 401);
  assert.equal(await recordLiveAssessment(db, secret, assessmentToken("other", 5n), body), 401);
  assert.equal(recorded.length, 0);
  assert.equal(await recordLiveAssessment(db, secret, token, body), 200);
  assert.deepEqual(recorded, [{ callId: 5n, providerId: "conv-demo", choice: "3", people: 2, oxygen: true }]);
});

test("live tools reject invented or malformed answers and stale calls", async () => {
  const { db, body, recorded } = fixture();
  const secret = "test-only-secret", token = assessmentToken(secret, 5n);
  for (const patch of [{ choice: "maybe" }, { people: 0 }, { people: 2.5 }, { oxygen: "yes" }, { conversation_id: "" }]) {
    assert.equal(await recordLiveAssessment(db, secret, token, { ...body, ...patch }), 400);
  }
  db.call = () => undefined;
  assert.equal(await recordLiveAssessment(db, secret, token, body), 409);
  assert.equal(recorded.length, 0);
});

test("assessment HTTP endpoint persists live answers and exposes a read-only readiness check", async t => {
  const previous = process.env.ELEVENLABS_WEBHOOK_SECRET;
  process.env.ELEVENLABS_WEBHOOK_SECRET = "test-only-secret";
  t.after(() => { if (previous === undefined) delete process.env.ELEVENLABS_WEBHOOK_SECRET; else process.env.ELEVENLABS_WEBHOOK_SECRET = previous; });
  const { db, body, recorded } = fixture();
  const server = createServer(db); // Mock database only; no runner, dialer or provider client starts.
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  assert.deepEqual(await (await fetch(`${url}/capabilities`)).json(), { liveAssessment: true });
  const send = (token?: string) => fetch(`${url}/elevenlabs/assessment`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-assessment-token": token } : {}) }, body: JSON.stringify(body) });
  assert.equal((await send()).status, 401);
  assert.equal(recorded.length, 0);
  const response = await send(assessmentToken("test-only-secret", 5n));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { recorded: true });
  assert.equal(recorded.length, 1);
});

test("the three demo contacts yield only the resident and selected human, with ambiguous destinations refused", () => {
  const phones = ["+12145553841", "+16825555303", "+14695554623"];
  assert.deepEqual(demoContacts(phones), { resident: phones[1], dispatcher: phones[0] });
  assert.throws(() => demoContacts(["*", ...phones]), /exactly three/);
  assert.throws(() => demoContacts([phones[0], phones[0], phones[1]]), /exactly three/);
  assert.throws(() => demoContacts(phones, "5303", "5303"), /different/);
  assert.throws(() => demoContacts(phones, "9999"), /exactly one/);
});

test("demo agent saves assessment before live transfer and contains exactly one configured human destination", () => {
  const config = demoAgentConfig("hook-test", "+12145553841", "https://voice.example.test");
  const prompt = config.conversationConfig.agent.prompt;
  assert.equal(prompt.tools[0].apiSchema.url, "https://voice.example.test/elevenlabs/assessment");
  assert.deepEqual(prompt.tools[0].apiSchema.requestHeaders, { "x-assessment-token": { variableName: "secret__assessment_token" } });
  assert.equal(prompt.builtInTools.transferToNumber.params.transfers.length, 1);
  assert.equal(prompt.builtInTools.transferToNumber.params.transfers[0].transferDestination.phoneNumber, "+12145553841");
  assert.match(prompt.prompt, /wait for recorded=true/);
  assert.match(prompt.builtInTools.transferToNumber.params.transfers[0].condition, /resident agreed/);
  assert.throws(() => demoAgentConfig("hook", "+12145553841", "http://voice.example.test"), /HTTPS/);
});

test("SIP transfer acceptance remains unconfirmed while provider errors create a failed handoff without leaking phones", async t => {
  const previous = env.allowlist;
  env.allowlist = ["+12145553841", "+16825555303", "+14695554623"];
  t.after(() => { env.allowlist = previous; });
  const reports: { status: string; targetLabel: string; detail?: string; failureReason?: string }[] = [];
  const db = { call: () => undefined, callEnded: async () => undefined, reportCallHandoff: async (report: typeof reports[number]) => { reports.push(report); } } as unknown as Contract;
  const event = (result_type: string, is_error: boolean) => ({ type: "post_call_transcription", data: { conversation_id: "conv-test",
    conversation_initiation_client_data: { dynamic_variables: { call_id: "5" } },
    transcript: [{ role: "agent", message: null, tool_results: [{ tool_name: "transfer_to_number", is_error, result: { result_type } }] }],
  } });
  await handleElevenlabsEvent(db, event("transfer_to_number_sip_success", false));
  await handleElevenlabsEvent(db, event("transfer_to_number_error", true));
  assert.equal(reports[0].status, "requested");
  assert.match(reports[0].detail!, /unconfirmed/);
  assert.equal(reports[1].status, "failed");
  assert(reports.every(row => row.targetLabel === "Demo dispatcher ending 3841"));
  assert(!JSON.stringify(reports, (_key, value) => typeof value === "bigint" ? String(value) : value).includes("+12145553841"));
});
