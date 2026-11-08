/** Shared, deterministic triage vocabulary for the rehearsal and guarded voice agent. */
export type Catastrophe = "flood" | "wildfire" | "hurricane" | "tornado";
export const CATASTROPHES: readonly Catastrophe[] = ["flood", "wildfire", "hurricane", "tornado"];
export const TRIAGE = {
  flood: { label: "Flash flooding", signal: "Rising water / blocked access", questions: ["Is water entering your home?", "Is floodwater blocking your exits?", "Does anyone need assistance moving to a higher floor?"] },
  wildfire: { label: "Wildfire", signal: "Smoke / fire proximity", questions: ["Can you see flames or heavy smoke near your home?", "Is smoke affecting anyone's breathing?", "Do you have transport available to leave if it is safe?"] },
  hurricane: { label: "Hurricane", signal: "Wind damage / power dependency", questions: ["Has your home been damaged by the storm?", "Has your home lost power?", "Does anyone rely on powered medical equipment?"] },
  tornado: { label: "Tornado", signal: "Structural damage / shelter access", questions: ["Is there structural damage to your home?", "Can everyone reach an interior shelter space?", "Is anyone trapped or injured?"] },
} satisfies Record<Catastrophe, { label: string; signal: string; questions: readonly string[] }>;

export type Classification = { kind: "classified"; category: Catastrophe; evidence: string } | { kind: "unknown" } | { kind: "ambiguous"; categories: Catastrophe[] };
const SIGNALS: Record<Catastrophe, RegExp> = {
  flood: /\b(flood(?:ing|water|waters)?|rising water|water (?:is )?(?:entering|coming into|inside)|bayou (?:is )?overflowing)\b/i,
  wildfire: /\b(wildfire|forest fire|brush fire|flames|heavy smoke|smoke (?:is )?(?:near|outside|entering))\b/i,
  hurricane: /\b(hurricane|storm surge|hurricane winds)\b/i,
  tornado: /\b(tornado|twister|funnel cloud)\b/i,
};

/** Multiple hazards remain ambiguous. Negated or hypothetical sentences do not establish a hazard. */
export function classifyCatastrophe(text: string): Classification {
  const observations = text.split(/[.!?;\n]+/).map(s => s.trim()).filter(s => s && !/\b(no|not|never|without|if|might|maybe|could|isn't|isn’t|aren't|aren’t)\b/i.test(s));
  const matches = CATASTROPHES.flatMap(category => {
    const evidence = observations.find(s => SIGNALS[category].test(s));
    return evidence ? [{ category, evidence }] : [];
  });
  if (!matches.length) return { kind: "unknown" };
  if (matches.length > 1) return { kind: "ambiguous", categories: matches.map(m => m.category) };
  return { kind: "classified", ...matches[0] };
}

export function catastrophePrompt() {
  return `CATASTROPHE TRIAGE: First identify the hazard from the resident's actual observations or the verified incident context. Do not infer a disaster from a hypothetical or negated statement. If unknown or conflicting, ask: "What danger are you experiencing at your home?" Never describe a keyword match as a verified warning. Select relevant questions below, one at a time, without repeating answered questions. Skip questions that do not apply. Continue collecting mobility, household size and oxygen needs. Immediate danger takes precedence over completing the survey.\n${CATASTROPHES.map(category => `${TRIAGE[category].label}: ${TRIAGE[category].questions.join(" ")}`).join("\n")}`;
}
