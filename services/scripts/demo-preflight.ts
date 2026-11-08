import { elevenlabs } from "../src/elevenlabs";
import { env } from "../src/env";
import { inboundDemoChecks } from "../src/demo-readiness";

try {
  const options = { timeoutInSeconds: 15, maxRetries: 0 };
  const client = elevenlabs().conversationalAi;
  const [capabilitiesResponse, readinessResponse, agent, phone] = await Promise.all([
    fetch(`${env.voice.publicUrl()}/capabilities`, { signal: AbortSignal.timeout(10_000) }),
    fetch(`${env.voice.publicUrl()}/ready`, { signal: AbortSignal.timeout(10_000) }),
    client.agents.get(env.elevenlabs.agentId(), options),
    client.phoneNumbers.get(env.elevenlabs.phoneNumberId(), options),
  ]);
  if (!capabilitiesResponse.ok) throw new Error("Receiver capabilities unavailable");
  const hook = agent.platformSettings?.workspaceOverrides?.webhooks;
  const checks = inboundDemoChecks({ capabilities: await capabilitiesResponse.json(), readiness: readinessResponse.ok ? await readinessResponse.json() : {},
    prompt: agent.conversationConfig.agent?.prompt?.prompt ?? "", phoneAgentId: phone.assignedAgent?.agentId, agentId: agent.agentId,
    webhookId: hook?.postCallWebhookId, configuredWebhookId: process.env.ELEVENLABS_WEBHOOK_ID,
    transcriptEnabled: Boolean(hook?.events?.includes("transcript") && !hook.excludeTranscript),
  });
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.detail}`);
  console.log("Read-only preflight; no calls, messages or database changes. A passing result still requires a human inbound-call rehearsal for audio, transcript and dispatcher review.");
  if (checks.some(c => !c.ok)) process.exitCode = 1;
} catch {
  console.error("Inbound demo preflight failed: check receiver reachability, /ready and provider configuration. No call was placed.");
  process.exitCode = 1;
}
