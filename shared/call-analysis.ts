export type AnalysisTurn = { speaker: string; text: string };
export type CallAnalysisResult = {
  summary: string;
  priority: "critical" | "high" | "normal" | "unknown";
  priorityReason: string;
  facts: { fact: string; turn: number; quote: string }[];
  unknowns: string[];
  recommendedActions: string[];
};

export const CALL_ANALYSIS_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" }, priority: { type: "string", enum: ["critical", "high", "normal", "unknown"] }, priorityReason: { type: "string" },
    facts: { type: "array", items: { type: "object", additionalProperties: false, properties: { fact: { type: "string" }, turn: { type: "integer" }, quote: { type: "string" } }, required: ["fact", "turn", "quote"] } },
    unknowns: { type: "array", items: { type: "string" } }, recommendedActions: { type: "array", items: { type: "string" } },
  }, required: ["summary", "priority", "priorityReason", "facts", "unknowns", "recommendedActions"],
} as const;

export function parseCallAnalysis(raw: unknown, turns: readonly AnalysisTurn[]): CallAnalysisResult {
  const v = raw as CallAnalysisResult;
  const text = (s: unknown, max = 4000) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
  const list = (a: unknown) => Array.isArray(a) && a.length <= 30 && a.every(s => text(s, 1000));
  if (!v || !text(v.summary) || !["critical", "high", "normal", "unknown"].includes(v.priority) || !text(v.priorityReason, 1500) ||
    !list(v.unknowns) || !list(v.recommendedActions) || !Array.isArray(v.facts) || v.facts.length > 30 ||
    !v.facts.every(f => f && text(f.fact, 1500) && Number.isInteger(f.turn) && f.turn >= 0 && f.turn < turns.length && text(f.quote, 2000) && turns[f.turn].text.includes(f.quote))) {
    throw new Error("Invalid Claude analysis or transcript evidence");
  }
  return { summary: v.summary, priority: v.priority, priorityReason: v.priorityReason,
    facts: v.facts.map(f => ({ fact: f.fact, turn: f.turn, quote: f.quote })), unknowns: v.unknowns, recommendedActions: v.recommendedActions };
}
