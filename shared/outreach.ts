import { CATASTROPHES, type Catastrophe } from "./catastrophe-triage";
export const OUTREACH_PHASES = ["reserved", "ringing", "live", "completed", "failed", "uncertain"] as const;
export type OutreachPhase = typeof OUTREACH_PHASES[number];
export type OutreachTurn = { speaker: "agent" | "resident"; text: string };
export type OutreachContact = { callId: string; label: string; phase: OutreachPhase; providerId?: string; error?: string; turns: OutreachTurn[] };
export type OutreachBatch = { batchId: string; category: Catastrophe; contacts: OutreachContact[] };
export function parseOutreachResponse(input: unknown): OutreachBatch | undefined {
  if (!input || typeof input !== "object" || !("batch" in input)) throw new Error("Invalid outreach response");
  const batch = input.batch;
  if (batch === null) return;
  if (!batch || typeof batch !== "object" || !("batchId" in batch) || typeof batch.batchId !== "string" || !("category" in batch) || !("contacts" in batch) || !Array.isArray(batch.contacts) || batch.contacts.length !== 3) throw new Error("Invalid outreach batch");
  const category = CATASTROPHES.find(category => category === batch.category);
  if (!category) throw new Error("Invalid outreach incident");
  const contacts = batch.contacts.map((contact: unknown): OutreachContact => {
    if (!contact || typeof contact !== "object" || !("callId" in contact) || typeof contact.callId !== "string" || !/^\d{1,20}$/.test(contact.callId) || !("label" in contact) || typeof contact.label !== "string" || !("phase" in contact) || !("turns" in contact) || !Array.isArray(contact.turns)) throw new Error("Invalid outreach contact");
    const phase = OUTREACH_PHASES.find(phase => phase === contact.phase);
    if (!phase) throw new Error("Invalid outreach phase");
    const turns = contact.turns.map((turn: unknown): OutreachTurn => {
      if (!turn || typeof turn !== "object" || !("speaker" in turn) || (turn.speaker !== "agent" && turn.speaker !== "resident") || !("text" in turn) || typeof turn.text !== "string") throw new Error("Invalid speech turn");
      return { speaker: turn.speaker, text: turn.text };
    });
    return { callId: contact.callId, label: contact.label, phase, turns, error: "error" in contact && typeof contact.error === "string" ? contact.error : undefined, providerId: "providerId" in contact && typeof contact.providerId === "string" ? contact.providerId : undefined };
  });
  return { batchId: batch.batchId, category, contacts };
}
