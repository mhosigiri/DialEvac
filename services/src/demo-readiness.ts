import { receiverCheck, type OutboundCheck } from "./outbound-demo";
import { VOICE_SAFETY_RULES } from "./voice-safety";

export function inboundDemoChecks(input: {
  capabilities: Parameters<typeof receiverCheck>[0] & { outboundEnabled?: boolean };
  readiness: { ready?: boolean; checks?: Record<string, boolean> };
  prompt: string;
  phoneAgentId?: string;
  agentId: string;
  webhookId?: string;
  configuredWebhookId?: string;
  transcriptEnabled: boolean;
}): OutboundCheck[] {
  return [receiverCheck(input.capabilities),
    { label: "Receiver dependencies", ok: input.readiness.ready === true && Boolean(input.readiness.checks) && ["database", "durableStorage", "analysisConfigured", "stopping"].every(key => input.readiness.checks?.[key] === true), detail: "Database subscription, durable spool and analysis credentials must be ready" },
    { label: "Receive-only inbox", ok: input.capabilities.outboundEnabled === false, detail: "The inbox must not start automatic outbound calls" },
    { label: "Inbound number assignment", ok: input.phoneAgentId === input.agentId, detail: "The configured inbound number must use the intended agent" },
    { label: "Transcript delivery", ok: Boolean(input.configuredWebhookId && input.webhookId === input.configuredWebhookId && input.transcriptEnabled), detail: "The agent must deliver transcripts to the configured webhook" },
    { label: "Voice safety rules deployed", ok: input.prompt.trimEnd().endsWith(VOICE_SAFETY_RULES), detail: "The configured agent must end with the complete current safety block" },
  ];
}
