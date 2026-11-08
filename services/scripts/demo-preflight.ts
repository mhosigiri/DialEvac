import { elevenlabs } from "../src/elevenlabs";
import { env } from "../src/env";
import { inboundDemoChecks } from "../src/demo-readiness";

try {
  const options = { timeoutInSeconds: 15, maxRetries: 0 };
  const client = elevenlabs().conversationalAi;
  const results = await Promise.allSettled([
    fetch(`${env.voice.publicUrl()}/capabilities`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`${env.voice.publicUrl()}/ready`, { signal: AbortSignal.timeout(10_000) }),
    client.agents.get(env.elevenlabs.agentId(), {}, options),
    client.phoneNumbers.get(env.elevenlabs.phoneNumberId(), options),
  ]);
  const labels = ["Receiver capabilities", "Receiver readiness", "ElevenLabs agent", "Inbound number"];
  let unavailable = false;
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.status === "rejected") {
      const code = result.reason?.cause?.code ?? result.reason?.name;
      const detail = typeof code === "string" && /^[A-Za-z_]{1,40}$/.test(code) ? ` (${code})` : "";
      console.log(`FAIL ${labels[index]}: request failed or timed out${detail}`);
      unavailable = true;
    }
    else if (result.value instanceof Response && !result.value.ok) { console.log(`FAIL ${labels[index]}: HTTP ${result.value.status}`); unavailable = true; }
  }
  if (unavailable) {
    console.log("Read-only preflight; no calls, messages or database changes. Restore the failed dependencies before rehearsing.");
    process.exitCode = 1;
  } else {
    const [capabilitiesResult, readinessResult, agentResult, phoneResult] = results;
    if (capabilitiesResult.status !== "fulfilled" || readinessResult.status !== "fulfilled" || agentResult.status !== "fulfilled" || phoneResult.status !== "fulfilled") throw new Error("Missing preflight response");
    const agent = agentResult.value, phone = phoneResult.value;
    const hook = agent.platformSettings?.workspaceOverrides?.webhooks;
    const checks = inboundDemoChecks({ capabilities: await capabilitiesResult.value.json(), readiness: await readinessResult.value.json(),
      prompt: agent.conversationConfig.agent?.prompt?.prompt ?? "", phoneAgentId: phone.assignedAgent?.agentId, agentId: agent.agentId,
      webhookId: hook?.postCallWebhookId, configuredWebhookId: process.env.ELEVENLABS_WEBHOOK_ID,
      transcriptEnabled: Boolean(hook?.events?.includes("transcript") && !hook.excludeTranscript),
    });
    for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.detail}`);
    console.log("Read-only preflight; no calls, messages or database changes. A passing result still requires a human inbound-call rehearsal for audio, transcript and dispatcher review.");
    if (checks.some(c => !c.ok)) process.exitCode = 1;
  }
} catch {
  console.error("Inbound demo preflight failed: check receiver reachability, /ready and provider configuration. No call was placed.");
  process.exitCode = 1;
}
