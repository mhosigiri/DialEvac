import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { DbConnection } from "../src/module_bindings";
import { contractFor } from "../src/db";
import { createServer } from "../src/voice";
import { elevenlabs } from "../src/elevenlabs";
import { env } from "../src/env";
import { demoContacts } from "../src/demo-handoff";
import { HOUSTON_DEMO } from "../../shared/demo";
import { SPACETIME_URI, SPACETIME_DEMO_DATABASE } from "../../shared/spacetime";
import { normalizeConversation, conversationFromWebhook } from "../src/call-ingestion";
import { analysisModel, analyzeTranscript } from "../src/claude-analysis";
import { spoolConversation, drainSpool } from "../src/call-spool";
import type { Contract } from "../src/contract";

// This process receives/archives/analyzes calls. It never starts voice or messaging runners.
const uri = SPACETIME_URI, database = SPACETIME_DEMO_DATABASE;
assert(!process.env.CALL_INBOX_DATABASE || process.env.CALL_INBOX_DATABASE === database, "Only hackutd-richardson is authorized");
const authPath = new URL("../../.spacetime/demo-auth.json", import.meta.url);
const persisted = existsSync(authPath) ? JSON.parse(readFileSync(authPath, "utf8")) : {};
const token = process.env.SPACETIME_DEMO_SERVICE_TOKEN || persisted.service?.token;
assert(token, "An existing granted demo service token is required");
const directory = fileURLToPath(new URL("../.spacetime/call-inbox/", import.meta.url));
const target = { uri, database };
let connection: DbConnection | undefined;
let stopping = false;
const api = elevenlabs();
const agentId = env.elevenlabs.agentId();
const timeout = <T>(promise: Promise<T>, ms = 10_000) => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { connection?.disconnect(); connection = undefined; reject(new Error("Database operation timed out")); }, ms); })]).finally(() => clearTimeout(timer));
};
const db = new Proxy({ target } as Contract, { get: (_object, key) => {
  if (key === "target") return target;
  if (!connection?.isActive) return () => { throw new Error("Call inbox database is reconnecting"); };
  const contract = contractFor(connection, target);
  return Reflect.get(contract, key);
} });

function openDatabase() {
  return new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => { c.disconnect(); reject(new Error("Call inbox connection timed out")); }, 10_000);
    const c = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); })
        .onError(() => { clearTimeout(timer); conn.disconnect(); reject(new Error("Call inbox subscription failed")); })
        .subscribe(["household", "call", "call_record", "call_analysis"].map(table => `SELECT * FROM ${table}`)))
      .onConnectError(() => { clearTimeout(timer); reject(new Error("Call inbox connection failed")); })
      .onDisconnect(() => { if (connection === c) connection = undefined; }).build();
  });
}

async function ingest(providerId: string, event?: unknown) {
  const c = connection;
  if (!c?.isActive) throw new Error("Database is unavailable");
  const existing = c.db.callRecord.providerId.find(providerId);
  if (existing && existing.status !== "processing") return;
  let conversation;
  try { conversation = await api.conversationalAi.conversations.get(providerId, {}, { timeoutInSeconds: 10, maxRetries: 0 }); }
  catch {
    conversation = conversationFromWebhook(event, agentId);
    if (!conversation) throw new Error("Provider conversation unavailable; durable job retained");
  }
  if (conversation.agentId !== agentId) throw new Error("Conversation belongs to another agent");
  const args = normalizeConversation(conversation, phone => {
    const known = [...c.db.household.iter()].find(home => home.phone === phone);
    if (known) return known.id;
    // Match just the selected demo resident; all other unknown callers stay visible and unlinked.
    try {
      if (phone === demoContacts(env.allowlist).resident) return [...c.db.household.iter()].find(home => home.riderId === HOUSTON_DEMO.riderId)?.id;
    } catch { /* Missing demo contact configuration must not discard other callers. */ }
    return undefined;
  });
  await timeout(c.reducers.recordProviderCall(args));
  console.log(`[call-inbox] stored ${providerId} (${args.status}, ${args.turns.length} text turns)`);
  if (args.status === "processing") throw new Error("Conversation is still processing");
}

async function reconcile() {
  let cursor: string | undefined;
  do {
    const page = await api.conversationalAi.conversations.list({ agentId, pageSize: 100, cursor }, { timeoutInSeconds: 20, maxRetries: 1 });
    for (const call of page.conversations) {
      const stored = connection?.db.callRecord.providerId.find(call.conversationId);
      if (stored && stored.status !== "processing") continue;
      await spoolConversation(directory, call.conversationId);
    }
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);
}

async function analyzePending() {
  const c = connection;
  if (!c?.isActive) return;
  for (const row of c.db.callAnalysis.iter()) {
    if (!["pending", "failed", "analyzing"].includes(row.state) || Number(row.nextAttemptAt.toMillis()) > Date.now() || row.leaseUntil && Number(row.leaseUntil.toMillis()) > Date.now()) continue;
    const call = c.db.callRecord.providerId.find(row.providerId);
    if (!call?.turns.length) continue;
    const claimToken = randomUUID();
    try { await timeout(c.reducers.claimCallAnalysis({ providerId: row.providerId, revision: row.revision, claimToken })); } catch { continue; }
    try {
      const { model, result } = await analyzeTranscript(call.turns);
      await timeout(c.reducers.finishCallAnalysis({ providerId: row.providerId, revision: row.revision, claimToken, model, resultJson: JSON.stringify(result), error: undefined }));
      console.log(`[call-inbox] Claude analysis ready for ${row.providerId}`);
    } catch (error) {
      const safe = error instanceof Error && /^Claude /.test(error.message) ? error.message.slice(0, 250) : "Claude analysis failed; automatic retry scheduled";
      if (connection?.isActive) await timeout(connection.reducers.finishCallAnalysis({ providerId: row.providerId, revision: row.revision, claimToken,
        model: analysisModel(), resultJson: undefined, error: safe }));
      console.error(`[call-inbox] ${row.providerId}: ${safe}`);
    }
  }
}

const server = createServer(db, { onWebhook: async event => {
  if (!["post_call_transcription", "call_initiation_failure"].includes(event.type)) return;
  const id = event.data.conversation_id;
  if (!id) throw new Error("Conversation id missing");
  await spoolConversation(directory, id, event);
}, capabilities: { transcriptIngestion: true, claudeAnalysis: true, outboundEnabled: false } });

if (!process.argv.includes("--once")) server.listen(env.voice.port, () => console.log(`[call-inbox] listening on :${env.voice.port}; ${database}; outbound disabled`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; server.close(); connection?.disconnect(); });
let nextReconcile = 0;
do {
  try {
    if (!connection?.isActive) connection = await openDatabase();
    if (Date.now() >= nextReconcile) {
      try { await reconcile(); } catch { console.error("[call-inbox] provider reconciliation will retry"); }
      nextReconcile = Date.now() + 30_000;
    }
    const pending = await drainSpool(directory, ingest);
    if (pending) console.error(`[call-inbox] ${pending} durable ingestion jobs will retry`);
    await analyzePending();
  } catch { console.error("[call-inbox] processing interrupted; durable work will retry"); }
  if (!stopping && !process.argv.includes("--once")) await sleep(3000);
} while (!stopping && !process.argv.includes("--once"));
connection?.disconnect();
