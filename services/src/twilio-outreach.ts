import { DatabaseSync } from "node:sqlite";
import type { Contract, LiveAssessment, CallHandoffUpdate, ConversationTranscript } from "./contract";
import { env, isFictional } from "./env";
import { assertGuardedAgent, elevenlabs, outboundCall, type CallVariables, type WebhookEvent } from "./elevenlabs";
import { isSurveyChoice, type ResidentSpeechState } from "../../spacetimedb/src/domain/honesty";
import { CATASTROPHES, type Catastrophe } from "../../shared/catastrophe-triage";

const LOCAL_ID = 9_000_000_000_000_000n;
import type { OutreachPhase, OutreachTurn, OutreachBatch } from "../../shared/outreach";
import type { GuardChat } from "./voice-guard";
export function outreachContacts(phones: readonly string[], from: string) {
  if (phones.length !== 3 || new Set(phones).size !== 3 || phones.some(phone => !/^\+[1-9]\d{7,14}$/.test(phone) || isFictional(phone) || phone === from)) throw new Error("Outreach requires exactly three distinct, real E.164 contacts, different from TWILIO_NUMBER");
  return [...phones];
}
export function parseLaunch(input: unknown): { batchId: string; category: Catastrophe } {
  if (!input || typeof input !== "object" || Object.keys(input).some(key => key !== "batchId" && key !== "category") || !("batchId" in input) || typeof input.batchId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(input.batchId) || !("category" in input)) throw new Error("Invalid outreach request");
  const category = CATASTROPHES.find(value => value === input.category);
  if (!category) throw new Error("Invalid incident category");
  return { batchId: input.batchId, category };
}
function parseTurns(value: unknown): OutreachTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(turn => turn && typeof turn === "object" && "speaker" in turn && ["agent", "resident"].includes(turn.speaker) && "text" in turn && typeof turn.text === "string"
    ? [{ speaker: turn.speaker === "agent" ? "agent" : "resident", text: turn.text }] : []);
}
function phaseFrom(value: unknown): OutreachPhase {
  if (value === "reserved" || value === "ringing" || value === "live" || value === "completed" || value === "failed" || value === "uncertain") return value;
  throw new Error("Invalid persisted call phase");
}

/** Durable private calls and assessments; existing signed tool and speech gates use the same Contract. */
export class OutreachStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, category TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, batch TEXT NOT NULL, phone TEXT NOT NULL, phase TEXT NOT NULL,
        provider TEXT UNIQUE, error TEXT, choice TEXT, people INTEGER, oxygen INTEGER, handoff TEXT, turns TEXT NOT NULL DEFAULT '[]');`);
    // Reserved entries were committed before attempting a dial. After a crash their external outcome is unknown.
    this.db.prepare("UPDATE contacts SET phase='uncertain', error='Service restarted; inspect provider history before another launch' WHERE phase='reserved'").run();
  }
  private row(id: bigint) { return this.db.prepare("SELECT * FROM contacts WHERE id=?").get(String(id)); }
  hasCall(id: bigint) { return Boolean(this.row(id)); }
  hasProvider(id: string) { return Boolean(this.db.prepare("SELECT id FROM contacts WHERE provider=?").get(id)); }
  finishedProvider(id: string) { const row = this.db.prepare("SELECT phase FROM contacts WHERE provider=?").get(id); return row?.phase === "completed" || row?.phase === "failed"; }
  phone(id: bigint) { const phone = this.row(id)?.phone; return typeof phone === "string" ? phone : undefined; }
  get(batchId: string): OutreachBatch | undefined {
    const batch = this.db.prepare("SELECT category FROM batches WHERE id=?").get(batchId);
    if (!batch) return;
    const category = CATASTROPHES.find(category => category === batch.category);
    if (!category) throw new Error("Invalid stored incident");
    const rows = this.db.prepare("SELECT * FROM contacts WHERE batch=? ORDER BY id").all(batchId);
    return { batchId, category, contacts: rows.map(row => {
      if (typeof row.id !== "string" || typeof row.phone !== "string" || typeof row.turns !== "string") throw new Error("Invalid stored contact");
      return { callId: row.id, label: `Contact ending ${row.phone.slice(-4)}`, phase: phaseFrom(row.phase), providerId: typeof row.provider === "string" ? row.provider : undefined,
        error: typeof row.error === "string" ? row.error : undefined, turns: parseTurns(JSON.parse(row.turns)) };
    }) };
  }
  latest() { const row = this.db.prepare("SELECT id FROM batches ORDER BY created DESC LIMIT 1").get(); return typeof row?.id === "string" ? this.get(row.id) : undefined; }
  reserve(batchId: string, category: Catastrophe, phones: string[]) {
    const existing = this.get(batchId);
    if (existing) return existing;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.db.prepare("SELECT id FROM contacts WHERE phase IN ('reserved','ringing','live','uncertain') LIMIT 1").get()) throw new Error("An outreach call may still be active. Review its status before launching again.");
      this.db.prepare("INSERT INTO batches VALUES (?,?,?)").run(batchId, category, Date.now());
      phones.forEach((phone, index) => {
        const id = LOCAL_ID + BigInt(Date.now()) * 100n + BigInt(index);
        this.db.prepare("INSERT INTO contacts (id,batch,phone,phase) VALUES (?,?,?,'reserved')").run(String(id), batchId, phone);
      });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(batchId)!;
  }
  submitted(id: bigint, providerId: string) { this.db.prepare("UPDATE contacts SET provider=?,phase=CASE WHEN phase='reserved' THEN 'ringing' ELSE phase END WHERE id=?").run(providerId, String(id)); }
  failed(id: bigint, uncertain: boolean) { this.db.prepare("UPDATE contacts SET phase=?,error=? WHERE id=?").run(uncertain ? "uncertain" : "failed", uncertain ? "Submission outcome unknown; do not redial before reviewing provider history" : "Provider refused the outbound call; no retry was made", String(id)); }
  private assessment(answer: LiveAssessment) {
    this.db.prepare("UPDATE contacts SET provider=?,phase='live',choice=CASE WHEN ?='' THEN choice ELSE ? END,people=COALESCE(?,people),oxygen=COALESCE(?,oxygen) WHERE id=?")
      .run(answer.providerId, answer.choice, answer.choice, answer.people ?? null, answer.oxygen === undefined ? null : Number(answer.oxygen), String(answer.callId));
  }
  private state(id: bigint): ResidentSpeechState | undefined {
    const row = this.row(id);
    if (!row) return;
    const confirmed = isSurveyChoice(row.choice);
    return { ride: null, assessmentRecorded: confirmed,
      assessment: isSurveyChoice(row.choice) ? { choice: row.choice, people: typeof row.people === "number" ? row.people : undefined, oxygen: typeof row.oxygen === "number" ? row.oxygen === 1 : undefined } : undefined, canLeave: confirmed ? row.choice === "1" : undefined,
      requestStatus: confirmed && row.choice !== "1" ? "received" : undefined, handoffStatus: typeof row.handoff === "string" ? row.handoff : undefined };
  }
  transcript(providerId: string, turns: OutreachTurn[], status: "completed" | "failed") {
    this.db.prepare("UPDATE contacts SET turns=?,phase=? WHERE provider=?").run(JSON.stringify(turns), status, providerId);
  }
  webhook(event: WebhookEvent) {
    if (event.type !== "post_call_transcription" && event.type !== "call_initiation_failure") return false;
    const data = event.data;
    const providerId = data.conversation_id;
    if (!providerId) return false;
    if (!this.hasProvider(providerId)) {
      const variables = "conversation_initiation_client_data" in data ? data.conversation_initiation_client_data?.dynamic_variables : undefined;
      if (!variables?.call_id || !/^\d{1,20}$/.test(variables.call_id) || !this.hasCall(BigInt(variables.call_id))) return false;
      this.submitted(BigInt(variables.call_id), providerId);
    }
    const turns = "transcript" in data ? (data.transcript ?? []).flatMap(turn => typeof turn.message === "string" && ["user", "agent"].includes(turn.role) ? [{ speaker: turn.role === "agent" ? "agent" as const : "resident" as const, text: turn.message }] : []) : [];
    this.transcript(providerId, turns, event.type === "call_initiation_failure" ? "failed" : "completed");
    return true;
  }
  speech(body: GuardChat, content: string | null | undefined) {
    const context = body.elevenlabs_extra_body?.guard_context ?? body.guard_context;
    if (!context?.call_id || !/^\d{1,20}$/.test(context.call_id) || !this.hasCall(BigInt(context.call_id))) return;
    const turns: OutreachTurn[] = body.messages.flatMap(message => (message.role === "user" || message.role === "assistant") && typeof message.content === "string"
      ? [{ speaker: message.role === "user" ? "resident" as const : "agent" as const, text: message.content }] : []);
    if (content) turns.push({ speaker: "agent", text: content });
    this.db.prepare("UPDATE contacts SET turns=?,phase=CASE WHEN phase IN ('reserved','ringing') THEN 'live' ELSE phase END WHERE id=?").run(JSON.stringify(turns), context.call_id);
  }
  withContract(fallback: Contract): Contract {
    return new Proxy(fallback, { get: (target, key) => {
      if (key === "call") return (id: bigint) => {
        const row = this.row(id);
        return row ? { id, householdId: id, purpose: "survey", priority: 1, phase: ["completed", "failed"].includes(String(row.phase)) ? "ended" : row.phase === "live" ? "live" : "ringing", providerId: typeof row.provider === "string" ? row.provider : "elevenlabs" } : target.call(id);
      };
      if (key === "household") return (id: bigint) => { const phone = this.phone(id); return phone ? { id, phone, name: "Resident", language: "en" } : target.household(id); };
      if (key === "residentState") return (id: bigint) => this.hasCall(id) ? this.state(id) : target.residentState?.(id);
      if (key === "recordCallAssessment") return async (answer: LiveAssessment) => this.hasCall(answer.callId) ? this.assessment(answer) : target.recordCallAssessment(answer);
      if (key === "reportCallHandoff") return async (handoff: CallHandoffUpdate) => this.hasCall(handoff.callId)
        ? void this.db.prepare("UPDATE contacts SET handoff=? WHERE id=?").run(handoff.status, String(handoff.callId)) : target.reportCallHandoff(handoff);
      if (key === "recordCallTranscript") return async (transcript: ConversationTranscript) => transcript.callId !== undefined && this.hasCall(transcript.callId)
        ? this.transcript(transcript.providerId, transcript.turns, "completed") : target.recordCallTranscript(transcript);
      return Reflect.get(target, key);
    } });
  }
}

export type OutreachDial = (phone: string, variables: CallVariables) => Promise<string>;
export function createOutreachCampaign(store: OutreachStore, options: { contacts: () => string[]; preflight: () => Promise<void>; dial: OutreachDial }) {
  let pending: Promise<OutreachBatch> | undefined;
  let currentBatch: string | undefined;
  return {
    status: () => store.latest(),
    async launch(input: unknown) {
      const { batchId, category } = parseLaunch(input);
      if (pending) {
        if (currentBatch === batchId) return pending;
        throw new Error("An outreach launch is already in progress");
      }
      const existing = store.get(batchId);
      if (existing) return existing;
      currentBatch = batchId;
      pending = (async () => {
        const contacts = options.contacts();
        await options.preflight();
        const batch = store.reserve(batchId, category, contacts);
        await Promise.allSettled(batch.contacts.map(async (contact, index) => {
          const id = BigInt(contact.callId);
          try {
            const providerId = await options.dial(contacts[index], { kind: "survey", call_id: contact.callId, callback_id: "", household_id: contact.callId, name: `Resident ${index + 1}`, incident_category: category });
            if (!providerId || providerId === "elevenlabs") { store.failed(id, true); return; }
            store.submitted(id, providerId);
          } catch (error) {
            const uncertain = !(error instanceof Error) || /timeout|timed out|abort|network|fetch failed/i.test(error.message);
            store.failed(id, uncertain);
          }
        }));
        return store.get(batchId)!;
      })();
      try { return await pending; } finally { pending = undefined; currentBatch = undefined; }
    },
  };
}

export async function twilioPreflight() {
  const api = elevenlabs();
  const [phone, agent] = await Promise.all([
    api.conversationalAi.phoneNumbers.get(env.twilio.phoneNumberId(), { timeoutInSeconds: 10, maxRetries: 0 }),
    api.conversationalAi.agents.get(env.twilio.agentId(), {}, { timeoutInSeconds: 10, maxRetries: 0 }),
  ]);
  if (phone.provider !== "twilio" || phone.phoneNumber !== env.twilio.number() || phone.supportsOutbound === false) throw new Error("Configured Twilio number is not ready for outbound calling");
  assertGuardedAgent(agent, env.voice.publicUrl());
  if (!process.env.VOICE_GUARD_TOKEN || process.env.VOICE_GUARD_TOKEN.length < 32) throw new Error("Blocking voice guard is not configured");
}
export function twilioCampaign(store: OutreachStore) {
  return createOutreachCampaign(store, { contacts: () => outreachContacts(env.allowlist, env.twilio.number()), preflight: twilioPreflight,
    dial: (phone, variables) => outboundCall(phone, variables, undefined, { provider: "twilio", agentId: env.twilio.agentId(), phoneNumberId: env.twilio.phoneNumberId() }) });
}
