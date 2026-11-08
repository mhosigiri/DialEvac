import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { DbConnection } from "../src/module_bindings";
import { elevenlabs, outboundCall } from "../src/elevenlabs";
import { env } from "../src/env";
import { demoContacts } from "../src/demo-handoff";
import { dialDemoAttempt, receiverCheck, sipCheck, type OutboundCheck } from "../src/outbound-demo";
import { HOUSTON_DEMO } from "../../shared/demo";
import { SPACETIME_DEMO_DATABASE, SPACETIME_URI } from "../../shared/spacetime";

async function main() {
  const { values } = parseArgs({ options: { call: { type: "boolean", default: false }, attempt: { type: "string" }, wait: { type: "boolean", default: false } } });
  const target = demoContacts(env.allowlist).resident;
  if (values.call && !values.attempt) throw new Error("A real call requires an explicit name: --call --attempt judges-01");
  const authPath = new URL("../../.spacetime/demo-auth.json", import.meta.url);
  const token = process.env.SPACETIME_DEMO_SERVICE_TOKEN || (existsSync(authPath) ? JSON.parse(readFileSync(authPath, "utf8")).service?.token : undefined);
  if (!token) throw new Error("Supply an existing granted SPACETIME_DEMO_SERVICE_TOKEN, or persist the demo service identity in .spacetime/demo-auth.json");
  const db = await new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => { c.disconnect(); reject(new Error("Demo subscription timed out")); }, 10_000);
    const c = DbConnection.builder().withUri(SPACETIME_URI).withDatabaseName(SPACETIME_DEMO_DATABASE).withToken(token)
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); }).onError(() => { clearTimeout(timer); conn.disconnect(); reject(new Error("Publish the outbound demo reducer before using this command")); })
        .subscribe(["household", "call", "outbound_demo_attempt", "call_record", "call_analysis"].map(t => `SELECT * FROM ${t}`)))
      .onConnectError(() => { clearTimeout(timer); reject(new Error("Cannot connect to demo database")); }).build();
  });

  try {
    console.log(`Outbound demonstration → phone ending ${target.slice(-4)} → ${SPACETIME_DEMO_DATABASE}`);
    const checks: OutboundCheck[] = [];
    const receiver = await fetch(`${env.voice.publicUrl()}/capabilities`, { signal: AbortSignal.timeout(10_000) });
    checks.push(receiver.ok ? receiverCheck(await receiver.json()) : { label: "Transcript receiver", ok: false, detail: `HTTP ${receiver.status}` });
    const sip = env.photon.sip();
    const [phone, agent] = await Promise.all([elevenlabs().conversationalAi.phoneNumbers.get(env.elevenlabs.phoneNumberId()), elevenlabs().conversationalAi.agents.get(env.elevenlabs.agentId())]);
    checks.push(sip ? sipCheck(phone, { phone: env.voice.fromNumber(), server: sip.server, username: sip.username }) : { label: "SIP trunk", ok: false, detail: "Photon SIP credentials are missing" });
    const hook = agent.platformSettings?.workspaceOverrides?.webhooks;
    checks.push({ label: "Post-call transcript webhook", ok: Boolean(hook && hook.postCallWebhookId === process.env.ELEVENLABS_WEBHOOK_ID && hook.events?.includes("transcript") && !hook.excludeTranscript),
      detail: "Agent must deliver the original transcript to the configured receiver" });
    checks.push({ label: "Demo agent", ok: phone.assignedAgent?.agentId === agent.agentId, detail: "Imported calling number must use the configured agent" });
    const home = [...db.db.household.iter()].find(h => h.riderId === HOUSTON_DEMO.riderId);
    checks.push({ label: "Synthetic resident", ok: Boolean(home?.simulated && home.phone === HOUSTON_DEMO.phone), detail: "Private real-contact mapping; fictional database phone is preserved" });
    const attempt = values.attempt && db.db.outboundDemoAttempt.attemptId.find(values.attempt);
    checks.push({ label: "Attempt name", ok: !attempt, detail: attempt ? `Already used for call ${attempt.callId}; choose a new name only after checking its outcome` : values.attempt ?? "Supply --attempt judges-01 when dialing" });
    for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.detail}`);
    const page = await elevenlabs().conversationalAi.conversations.list({ agentId: agent.agentId, pageSize: 20 });
    const last = page.conversations.find(c => c.direction === "outbound");
    if (last) {
      const previous = await elevenlabs().conversationalAi.conversations.get(last.conversationId);
      const error = previous.metadata.error;
      console.log(`Last outbound attempt: ${previous.status}${error ? `; SIP ${error.code}; ${String(error.reason ?? "").replace(/\+\d{8,15}/g, "[phone]")}` : ""}. Configuration checks do not prove the phone will ring.`);
    }
    if (checks.some(c => !c.ok)) throw new Error("Preflight failed; no phone call was placed");
    if (!values.call) console.log("Preview only; no call placed. To dial once: npm run demo:outbound -- --call --attempt judges-01 --wait");
    else {
      const result = await dialDemoAttempt({ attemptId: values.attempt!, allowlist: env.allowlist,
        startAttempt: async attemptId => {
          await db.reducers.startDemoOutboundAttempt({ attemptId });
          const receipt = db.db.outboundDemoAttempt.attemptId.find(attemptId);
          if (!receipt) throw new Error("Attempt result is unavailable; inspect the portal before trying again");
          return { callId: receipt.callId };
        }, failed: callId => db.reducers.callEnded({ callId, outcome: "failed" }), dial: outboundCall });
      console.log(`One dial submitted; call ${result.callId}; conversation ${result.providerId}. Watch Calls in the portal.`);
      if (values.wait) {
        const deadline = Date.now() + 6 * 60_000;
        let previous = "";
        while (Date.now() < deadline) {
          const archive = [...db.db.callRecord.iter()].find(r => r.callId === result.callId);
          const analysis = archive && db.db.callAnalysis.providerId.find(archive.providerId);
          const state = archive ? `${archive.status}; ${archive.turns.length} text turns; Claude ${analysis?.state ?? "waiting"}` : "Awaiting provider call status";
          if (state !== previous) { console.log(state); previous = state; }
          if (archive?.status === "failed") {
            const details = await elevenlabs().conversationalAi.conversations.get(archive.providerId);
            const reason = details.metadata.error;
            throw new Error(`Phone connection failed${reason ? `: SIP ${reason.code} ${String(reason.reason ?? "").replace(/\+\d{8,15}/g, "[phone]")}` : ""}; this attempt will not dial again`);
          }
          if (analysis && ["ready", "no_transcript", "failed"].includes(analysis.state)) break;
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        console.log("Portal keeps the call and transcript. --wait never starts or retries a phone call.");
      }
    }
  } finally { db.disconnect(); }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Outbound demo failed";
  console.error(message.replace(/\+\d{8,15}/g, "[phone]"));
  if (/603|Decline/.test(message)) console.error("The SIP/phone path rejected this call before connection. Inspect Photon Voice → Recent calls and ElevenLabs Conversations for the exact attempt. No automatic retry was made.");
  process.exitCode = 1;
});
