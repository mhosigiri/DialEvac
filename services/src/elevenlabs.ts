import { ElevenLabsClient, type ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { env } from "./env";
import { SURVEY_INTRO } from "../../spacetimedb/src/domain/script";

// ElevenLabs runs the conversation on every call; Photon is the line it dials out on (SIP trunk).
// The agent sorts what a resident says into the keypad's four choices, so a spoken answer lands in
// the module exactly like a pressed key (households.ts REPLIES).

// The SDK reads ELEVENLABS_API_KEY from the environment (.env, loaded by `tsx --env-file`).
let client: ElevenLabsClient | undefined;
export const elevenlabs = () => (client ??= new ElevenLabsClient());

export type CallKind = "survey" | "callback";

// Every dynamic variable the prompt names must be sent on every call, or the call fails to start.
export type CallVariables = { kind: CallKind; call_id: string; callback_id: string; name: string };

export async function outboundCall(to: string, variables: CallVariables, firstMessage?: string) {
  const result = await elevenlabs().conversationalAi.sipTrunk.outboundCall({
    agentId: env.elevenlabs.agentId(),
    agentPhoneNumberId: env.elevenlabs.phoneNumberId(),
    toNumber: to,
    conversationInitiationClientData: {
      dynamicVariables: variables,
      ...(firstMessage ? { conversationConfigOverride: { agent: { firstMessage } } } : {}),
    },
    telephonyCallConfig: { ringingTimeoutSecs: 30 },
  });
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
        transcript?: { role: string; message?: string | null; time_in_call_secs?: number }[];
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

If the kind is "callback": you already said the update. Answer short questions using only that update. Never promise times, vehicles or help you were not told about. Then say goodbye and end the call.

If the kind is "survey": find out, in as few turns as you can, which one of these is true:
1. They can leave on their own.
2. They need a ride but can walk to a car.
3. They need a wheelchair-accessible ride.
4. Someone must be lifted or carried out.
Also ask how many people are in the home and whether anyone uses oxygen, if they don't say.
Confirm their answer back in one sentence. If they can leave, tell them to leave now if it is safe. If they need help, say the request is recorded and someone will contact them; promise nothing else. Then end the call.

Always: speak plainly and briefly, one question at a time. If they are confused or upset, stay calm and repeat the choices. If it is an emergency happening right now, tell them to hang up and call 911. Never give medical or legal advice.`;

export function agentConfig(webhookId: string) {
  return {
    name: "Worst Day response line",
    conversationConfig: {
      agent: {
        firstMessage: `${SURVEY_INTRO} Are you able to leave your home on your own right now?`,
        language: "en",
        dynamicVariables: { dynamicVariablePlaceholders: { kind: "survey", call_id: "", callback_id: "", name: "there" } },
        prompt: {
          prompt: PROMPT,
          builtInTools: {
            endCall: { type: "system", name: "end_call", description: "", params: { systemToolType: "end_call" } },
            voicemailDetection: {
              type: "system",
              name: "voicemail_detection",
              description: "",
              params: { systemToolType: "voicemail_detection", voicemailMessage: `${SURVEY_INTRO} We will call back shortly.` },
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
      overrides: { conversationConfigOverride: { agent: { firstMessage: true } } },
      workspaceOverrides: { webhooks: { postCallWebhookId: webhookId, events: ["transcript", "call_initiation_failure"] } },
    },
  } satisfies ElevenLabs.conversationalAi.BodyCreateAgentV1ConvaiAgentsCreatePost;
}
