import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import { agentConfig } from "./elevenlabs";

export function demoContacts(allowlist: readonly string[], residentLast4 = "5303", dispatcherLast4 = "3841") {
  const phones = allowlist.map(phone => phone.trim());
  if (phones.length !== 3 || new Set(phones).size !== 3 || phones.some(phone => !/^\+[1-9]\d{7,14}$/.test(phone))) throw new Error("Demo requires exactly three distinct E.164 CONTACT_ALLOWLIST numbers");
  const pick = (last4: string) => {
    if (!/^\d{4}$/.test(last4)) throw new Error("Invalid demo contact suffix");
    const matches = phones.filter(phone => phone.endsWith(last4));
    if (matches.length !== 1) throw new Error("Demo contact must match exactly one allowlisted number");
    return matches[0];
  };
  const resident = pick(residentLast4), dispatcher = pick(dispatcherLast4);
  if (resident === dispatcher) throw new Error("Resident and human dispatcher must be different contacts");
  return { resident, dispatcher };
}

export function demoAgentConfig(webhookId: string, dispatcherPhone: string, publicUrl: string) {
  if (!/^\+[1-9]\d{7,14}$/.test(dispatcherPhone)) throw new Error("Invalid dispatcher phone");
  const base = new URL(publicUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error("Demo agent requires a public HTTPS service URL");
  const config = agentConfig(webhookId);
  const assessment: ElevenLabs.PromptAgentApiModelInputToolsItem = {
    type: "webhook", name: "record_assessment", description: "Record only answers the resident actually gave, before transferring this live survey call to the human dispatcher.",
    responseTimeoutSecs: 15, apiSchema: {
      url: `${publicUrl.replace(/\/$/, "")}/elevenlabs/assessment`, method: "POST",
      requestHeaders: { "x-assessment-token": { variableName: "secret__assessment_token" } },
      requestBodySchema: { type: "object", required: ["call_id", "conversation_id", "choice"], properties: {
        call_id: { type: "string", dynamicVariable: "call_id" },
        conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
        choice: { type: "string", enum: ["", "1", "2", "3", "4"], description: "1 can leave independently; 2 needs a ride and walks; 3 needs a wheelchair vehicle; 4 needs lifting/carrying. Empty string if unconfirmed. Never infer an answer." },
        people: { type: "integer", description: "Number of residents, only if confirmed; omit if unknown." },
        oxygen: { type: "boolean", description: "Whether anyone needs oxygen, only if confirmed; omit if unknown." },
      } },
    },
  };
  const handoff: ElevenLabs.PromptAgentApiModelInputToolsItem = {
    type: "webhook", name: "request_handoff", description: "After the resident agrees to human contact and the assessment is saved, record that transfer was requested. This does not claim a human answered.",
    apiSchema: { url: `${publicUrl.replace(/\/$/, "")}/elevenlabs/handoff`, method: "POST", requestHeaders: { "x-assessment-token": { variableName: "secret__assessment_token" } },
      requestBodySchema: { type: "object", required: ["call_id", "conversation_id"], properties: {
        call_id: { type: "string", dynamicVariable: "call_id" }, conversation_id: { type: "string", dynamicVariable: "system__conversation_id" },
      } } },
  };
  return {
    ...config,
    name: "State Farm Houston demo — single resident",
    conversationConfig: { ...config.conversationConfig, agent: { ...config.conversationConfig.agent,
      dynamicVariables: { dynamicVariablePlaceholders: { ...config.conversationConfig.agent.dynamicVariables.dynamicVariablePlaceholders, secret__assessment_token: "" } },
      firstMessage: "Hi {{name}}, this is a simulated catastrophe response demonstration. Are you able to leave your demo home safely, or would you need assistance?",
      prompt: { ...config.conversationConfig.agent.prompt,
        prompt: `${config.conversationConfig.agent.prompt.prompt}\n\nSINGLE-RESIDENT HOUSTON DEMO OVERRIDE:\nThis is a simulation. After gathering the survey answers, call record_assessment and wait for recorded=true. Do not end the survey call at that point. Ask whether the resident wants to speak to the human dispatcher. If they agree and the assessment was saved, call request_handoff and wait for requested=true, then use transfer_to_number. Transfer only to the configured dispatcher. Never promise a rescue unit or arrival time. If saving fails, explain that the update was not saved and do not claim the dispatcher received it. If transfer fails, explain that the connection failed; never report it as successful. Unknown answers stay unknown. For callback-kind calls, use the existing callback behavior and do not call any demo tool.`,
        tools: [assessment, handoff],
        builtInTools: { ...config.conversationConfig.agent.prompt.builtInTools,
          transferToNumber: { type: "system", name: "transfer_to_number", description: "Transfer the live demo survey to the configured human only after record_assessment succeeded and the resident agreed.",
            params: { systemToolType: "transfer_to_number", transfers: [{ transferDestination: { type: "phone", phoneNumber: dispatcherPhone },
              transferType: "sip_refer", condition: "The survey assessment was saved successfully and the resident agreed to speak with the human dispatcher." }] } },
        },
      },
    } },
  } satisfies ElevenLabs.conversationalAi.BodyCreateAgentV1ConvaiAgentsCreatePost;
}
