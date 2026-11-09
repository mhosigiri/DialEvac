import type { GuardChat } from "./voice-guard";
import type { Conversation } from "./voice-intake";
import { UNDERSTANDING_INSTRUCTIONS } from "./voice-intake";
import { TRIAGE, type Catastrophe } from "../../shared/catastrophe-triage";

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.flatMap(part => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? [part.text] : []).join("\n");
  return value == null ? "" : JSON.stringify(value);
}
function toolRequests(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(tool => {
    if (!tool || typeof tool !== "object" || !("function" in tool) || !tool.function || typeof tool.function !== "object") return [];
    const fn = tool.function;
    return "name" in fn && typeof fn.name === "string" ? [{ name: fn.name, arguments: "arguments" in fn ? fn.arguments : undefined }] : [];
  });
}
function parsedArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** ElevenLabs does not round-trip Gemini thought signatures. Treat history as transcript data,
 * rather than replaying incomplete Gemini function-call protocol messages on the next request. */
export function voiceModelMessages(body: GuardChat, category?: Catastrophe) {
  const transcript = body.messages.filter(message => message.role !== "system").map((message, index) => ({
    index, speaker: message.role, text: contentText(message.content),
    ...(message.role === "assistant" ? { requestedTools: toolRequests(message.tool_calls) } : {}),
    ...(message.role === "tool" && typeof message.name === "string" ? { toolName: message.name } : {}),
  }));
  const questions = category ? TRIAGE[category].questions : [];
  return [
    { role: "system", content: UNDERSTANDING_INSTRUCTIONS.replace("HAZARD_QUESTIONS", JSON.stringify(questions)) },
    { role: "user", content: JSON.stringify({ transcript }) },
  ];
}

export function conversationSoFar(body: GuardChat): Conversation {
  const spoken = body.messages.filter(message => message.role === "assistant");
  const requests = spoken.flatMap(message => toolRequests(message.tool_calls)).map(tool => ({ name: tool.name, args: parsedArguments(tool.arguments) }));
  const last = [...body.messages].reverse().find(message => message.role !== "system");
  const lastAssistantTools = last?.role === "tool" ? toolRequests([...spoken].reverse().find(message => Array.isArray(message.tool_calls))?.tool_calls) : [];
  return {
    agentLines: spoken.map(message => contentText(message.content)).filter(Boolean),
    toolRequests: requests,
    lastWasSave: lastAssistantTools.some(tool => tool.name === "record_assessment"),
    residentJustSpoke: last?.role === "user",
  };
}
