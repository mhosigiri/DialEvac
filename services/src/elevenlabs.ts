import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { env } from "./env";
import { SPEECH, guardResidentTurn } from "../../spacetimedb/src/domain/honesty";
import { assessmentToken } from "./live-assessment";
import { voiceGuardContext } from "./voice-guard";
import { withVoiceSafety } from "./voice-safety";
import { catastrophePrompt } from "../../shared/catastrophe-triage";

// ElevenLabs runs the conversation on every call; Photon is the line it dials out on (SIP trunk).
// The agent sorts what a resident says into the keypad's four choices, so a spoken answer lands in
// the module exactly like a pressed key (households.ts REPLIES).

// The SDK reads ELEVENLABS_API_KEY from the environment (.env, loaded by `tsx --env-file`).
let client: ElevenLabsClient | undefined;
export const elevenlabs = () => (client ??= new ElevenLabsClient());

export type CallKind = "survey" | "callback";

// Every dynamic variable the prompt names must be sent on every call, or the call fails to start.
export type CallVariables = { kind: CallKind; call_id: string; callback_id: string; name: string; household_id?: string };

export async function outboundCall(to: string, variables: CallVariables, firstMessage?: string) {
  const activeAgent = await elevenlabs().conversationalAi.agents.get(env.elevenlabs.agentId(), {}, { timeoutInSeconds: 10, maxRetries: 0 });
  assertGuardedAgent(activeAgent, env.voice.publicUrl());
  // A greeting can play while the phone is still connecting. Keep it neutral; all dispatch facts
  // are resolved afresh by the blocking turn endpoint after the resident responds.
  const greeting = guardResidentTurn(variables.kind === "callback" ? SPEECH.callbackFirst : firstMessage === SPEECH.demoFirst ? SPEECH.demoFirst : SPEECH.first).text;
  const result = await elevenlabs().conversationalAi.sipTrunk.outboundCall({
    agentId: env.elevenlabs.agentId(),
    agentPhoneNumberId: env.elevenlabs.phoneNumberId(),
    toNumber: to,
    conversationInitiationClientData: {
      dynamicVariables: { ...variables, ...(variables.kind === "survey" && /^\d+$/.test(variables.call_id)
        ? { secret__assessment_token: assessmentToken(env.elevenlabs.webhookSecret(), BigInt(variables.call_id)) } : {}) },
      customLlmExtraBody: { guard_context: voiceGuardContext(env.elevenlabs.webhookSecret(), variables) },
      conversationConfigOverride: { agent: { firstMessage: greeting } },
    },
    telephonyCallConfig: { ringingTimeoutSecs: 30 },
  }, { maxRetries: 0, timeoutInSeconds: 45 });
  if (!result.success) throw new Error(`ElevenLabs did not start the call: ${result.message}`);
  return result.conversationId ?? "elevenlabs";
}

// The SDK checks the ElevenLabs-Signature header (HMAC over the raw body, 30-minute replay window).
export async function verifiedEvent(rawBody: string, signature: string | undefined, secret: string): Promise<WebhookEvent | null> {
  if (!signature) return null;
  try {
    // Checking a signature needs only the webhook secret, not an API key.
    const checker = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY || "webhook-only" });
    return (await checker.webhooks.constructEvent(rawBody, signature, secret)) as WebhookEvent;
  } catch {
    return null;
  }
}

type Collected = Record<string, { value?: unknown } | undefined>;

// Webhook bodies arrive as raw JSON, so these fields are snake_case.
export type WebhookEvent =
  | {
      type: "post_call_transcription";
      data: {
        conversation_id: string;
        // Official raw post_call_transcription payload: role="agent"|"user", message may be null for tool-only turns.
        // https://elevenlabs.io/docs/eleven-api/resources/webhooks
        transcript?: { role: string; message?: string | null; time_in_call_secs?: number;
          tool_results?: { tool_name?: string; is_error?: boolean; result?: { result_type?: string; status?: string } }[] }[];
        metadata?: { termination_reason?: string };
        analysis?: { data_collection_results?: Collected };
        // ElevenLabs adds system__caller_id (E.164) to every phone call; an incoming call has no call_id.
        conversation_initiation_client_data?: { dynamic_variables?: Partial<CallVariables> & { system__caller_id?: string } };
      };
    }
  | {
      type: "call_initiation_failure";
      data: { conversation_id: string; failure_reason?: string; conversation_initiation_client_data?: { dynamic_variables?: Partial<CallVariables> } };
    }
  | { type: string; data: { conversation_id?: string } };

// What a finished call means for the module: the keypad choice it heard (if any), and the record
// fields it learned on the way.
export function surveyAnswer(collected: Collected = {}) {
  const value = (id: string) => collected[id]?.value;
  const choice = String(value("choice") ?? "");
  const people = Number(value("people"));
  const oxygen = value("oxygen");
  return {
    choice: ["1", "2", "3", "4"].includes(choice) ? choice : null,
    people: Number.isInteger(people) && people > 0 && people < 50 ? people : undefined,
    oxygen: typeof oxygen === "boolean" ? oxygen : undefined,
  };
}

export function failureOutcome(reason: string | undefined) {
  return reason === "busy" ? "busy" : reason === "no-answer" ? "no_answer" : "failed";
}

export const endedOn = (terminationReason = "") => (/voicemail/i.test(terminationReason) ? "voicemail" : "answered");

const PROMPT = `You are the automated voice of a local emergency response line, calling during an active warning.
You are calling {{name}}. This call's kind is "{{kind}}".

If the kind is "callback": use the current approved status phrase supplied by the blocking output gate. Never reuse a previous turn's assignment or ETA. Then say goodbye and end the call.

If the kind is "survey": find out, in as few turns as you can, which one of these is true:
1. They can leave on their own.
2. They need a ride but can walk to a car.
3. They need a wheelchair-accessible ride.
4. Someone must be lifted or carried out.
Also ask how many people are in the home and whether anyone uses oxygen, if they don't say.
Confirm their answer back in one sentence. If they can leave, tell them to leave only if it is safe. If they need help, acknowledge their request without claiming it is saved or promising a callback. Then end the call.

Always: speak plainly and briefly, one question at a time. If they are confused or upset, stay calm and repeat the choices. If it is an emergency happening right now, tell them to hang up and call 911. Never give medical or legal advice.`;

export function agentConfig(webhookId: string) {
  return {
    name: "Worst Day response line",
    conversationConfig: {
      agent: {
        firstMessage: SPEECH.first,
        maxConversationDurationMessage: SPEECH.goodbye,
        language: "en",
        dynamicVariables: { dynamicVariablePlaceholders: { kind: "survey", call_id: "", callback_id: "", name: "there" } },
        prompt: {
          prompt: withVoiceSafety(`${PROMPT}\n\n${catastrophePrompt()}`),
          builtInTools: {
            endCall: { type: "system", name: "end_call", description: "", params: { systemToolType: "end_call" } },
            voicemailDetection: {
              type: "system",
              name: "voicemail_detection",
              description: "",
              params: { systemToolType: "voicemail_detection", voicemailMessage: SPEECH.voicemail },
            },
          },
        },
      },
      conversation: { maxDurationSeconds: 300 },
    },
    platformSettings: {
      dataCollection: {
        choice: {
          type: "string",
          enum: ["1", "2", "3", "4"],
          description:
            "Survey calls only. 1 if they can leave on their own; 2 if they need a ride but can walk; 3 if they need a wheelchair-accessible ride; 4 if someone must be lifted or carried. Leave empty if they never answered.",
        },
        people: { type: "integer", description: "How many people are in the home, if they said. Leave empty otherwise." },
        oxygen: { type: "boolean", description: "True if anyone in the home uses oxygen, false if they said no one does. Leave empty if not discussed." },
      },
      overrides: { customLlmExtraBody: true, conversationConfigOverride: { agent: { firstMessage: true } } },
      workspaceOverrides: { webhooks: { postCallWebhookId: webhookId, events: ["transcript", "call_initiation_failure"] } },
    },
  } satisfies ElevenLabs.conversationalAi.BodyCreateAgentV1ConvaiAgentsCreatePost;
}

// Apply this reviewable configuration only after the guard endpoint is deployed and reachable.
// Backup models must be disabled: falling back to an unguarded model would bypass the release gate.
export function guardedAgentConfig(base: ElevenLabs.conversationalAi.BodyCreateAgentV1ConvaiAgentsCreatePost, publicUrl: string, secretId: string) {
  const url = new URL(publicUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !secretId.trim()) throw new Error("A public HTTPS guard URL and workspace secret ID are required");
  if (!singleAgentWorkflow(base.workflow)) throw new Error("Configure every workflow node before enabling the guard; this configuration supports a single agent");
  return { ...base,
    conversationConfig: { ...base.conversationConfig, agent: { ...base.conversationConfig?.agent, firstMessage: SPEECH.first, maxConversationDurationMessage: SPEECH.goodbye,
      prompt: { ...base.conversationConfig?.agent?.prompt, llm: "custom-llm", backupLlmConfig: { preference: "disabled" },
        builtInTools: { ...base.conversationConfig?.agent?.prompt?.builtInTools, voicemailDetection: { type: "system", name: "voicemail_detection", description: "Detect voicemail", params: { systemToolType: "voicemail_detection", voicemailMessage: SPEECH.voicemail } } },
        customLlm: { url: `${publicUrl.replace(/\/$/, "")}/voice/guard/v1`, apiType: "chat_completions", requestHeaders: { "x-voice-guard-token": { secretId } } } },
    } },
    platformSettings: { ...base.platformSettings, overrides: { ...base.platformSettings?.overrides, customLlmExtraBody: true,
      conversationConfigOverride: { ...base.platformSettings?.overrides?.conversationConfigOverride, agent: { ...base.platformSettings?.overrides?.conversationConfigOverride?.agent, firstMessage: true } } } },
  } satisfies ElevenLabs.conversationalAi.BodyCreateAgentV1ConvaiAgentsCreatePost;
}

export function assertGuardedAgent(agent: { workflow?: { nodes?: object }; conversationConfig?: { agent?: { firstMessage?: string; maxConversationDurationMessage?: string; prompt?: { llm?: string; customLlm?: { url: string; requestHeaders?: Record<string, unknown> }; backupLlmConfig?: { preference: string }; builtInTools?: { voicemailDetection?: { params?: unknown } } } } } }, publicUrl: string) {
  const config = agent.conversationConfig?.agent, prompt = config?.prompt;
  const expected = `${publicUrl.replace(/\/$/, "")}/voice/guard/v1`;
  const header = prompt?.customLlm?.requestHeaders?.["x-voice-guard-token"] as { secretId?: string } | undefined;
  const voicemail = prompt?.builtInTools?.voicemailDetection?.params as { voicemailMessage?: string } | undefined;
  if (!singleAgentWorkflow(agent.workflow) || prompt?.llm !== "custom-llm" || prompt.customLlm?.url !== expected || prompt.backupLlmConfig?.preference !== "disabled" || !header?.secretId || voicemail?.voicemailMessage !== SPEECH.voicemail ||
    ![SPEECH.first, SPEECH.demoFirst].includes(config?.firstMessage as typeof SPEECH.first) || config?.maxConversationDurationMessage !== SPEECH.goodbye) {
    throw new Error("The agent is not configured for the blocking honesty guard. Prepare and apply the guarded agent configuration before dialing.");
  }
}

function singleAgentWorkflow(value: unknown) {
  if (!value) return true;
  const workflow = value as { nodes?: Record<string, { type?: string }>; edges?: object };
  const nodes = Object.values(workflow.nodes ?? {});
  return nodes.length <= 1 && nodes.every(node => node.type === "start") && !Object.keys(workflow.edges ?? {}).length;
}
