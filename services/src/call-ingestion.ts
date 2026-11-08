import { Timestamp } from "spacetimedb";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";

// A verified webhook carries its own transcript. Use it when the provider's read API is down.
export function conversationFromWebhook(event: unknown, agentId: string): ElevenLabs.GetConversationResponseModel | undefined {
  const input = event as { type?: string; data?: Record<string, unknown> };
  const data = input?.data;
  if (!data || data.agent_id !== agentId || typeof data.conversation_id !== "string" || !["post_call_transcription", "call_initiation_failure"].includes(input.type ?? "")) return;
  const metadata = data.metadata as { start_time_unix_secs?: number; call_duration_secs?: number; phone_call?: { direction?: string } } | undefined;
  const initiation = data.conversation_initiation_client_data as { dynamic_variables?: Record<string, unknown> } | undefined;
  return { conversationId: data.conversation_id, agentId, status: input.type === "call_initiation_failure" ? "failed" : "done",
    metadata: { startTimeUnixSecs: metadata?.start_time_unix_secs, callDurationSecs: metadata?.call_duration_secs, phoneCall: metadata?.phone_call },
    conversationInitiationClientData: { dynamicVariables: initiation?.dynamic_variables }, transcript: Array.isArray(data.transcript) ? data.transcript : [],
  } as unknown as ElevenLabs.GetConversationResponseModel;
}

export function normalizeConversation(conversation: ElevenLabs.GetConversationResponseModel, matchPhone: (phone: string) => bigint | undefined) {
  const variables = conversation.conversationInitiationClientData?.dynamicVariables ?? {};
  const caller = typeof variables.system__caller_id === "string" ? variables.system__caller_id : undefined;
  const phone = conversation.metadata.phoneCall;
  const direction = phone?.direction === "inbound" ? "inbound" : phone?.direction === "outbound" ? "outbound" : caller ? "inbound" : "unknown";
  const u64 = (value: unknown) => typeof value === "string" && /^\d{1,20}$/.test(value) && BigInt(value) <= 0xffff_ffff_ffff_ffffn ? BigInt(value) : undefined;
  const start = conversation.metadata.startTimeUnixSecs;
  const duration = conversation.metadata.callDurationSecs;
  return {
    providerId: conversation.conversationId, agentId: conversation.agentId,
    callId: u64(variables.call_id), callbackId: u64(variables.callback_id), householdId: caller ? matchPhone(caller) : undefined,
    direction, status: conversation.status === "done" ? "done" : conversation.status === "failed" ? "failed" : "processing",
    callerLabel: caller && /\d{4}$/.test(caller) ? `Caller ending ${caller.slice(-4)}` : direction === "outbound" ? "Outbound call" : "Unknown caller",
    startedAt: Number.isFinite(start) ? new Timestamp(BigInt(Math.round(start * 1_000_000))) : undefined,
    durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : undefined,
    turns: (conversation.transcript ?? []).flatMap(turn => ["agent", "user"].includes(turn.role) && typeof turn.message === "string" && turn.message.trim()
      ? [{ speaker: turn.role === "agent" ? "agent" : "resident", text: turn.message }] : []),
  };
}
