import { setTimeout as sleep } from "node:timers/promises";
import { env, mayContact } from "./env";
import type { Contract, MessageRow } from "./contract";
import { PhotonError, photonClient, type ReceivedText } from "./photon";
import { guardResidentTurn } from "../../spacetimedb/src/domain/honesty";

// The Photon service. Sends every queued outbound message over iMessage (or prints it with the
// terminal provider) and hands every resident reply to the module, which decides what to answer.

type Send = (phone: string, body: string, idempotencyKey: string) => Promise<string>;

export async function deliver(db: Contract, row: MessageRow, send: Send) {
  if (row.direction !== "out") return;
  const home = db.household(row.householdId);
  if (!home) return;
  try {
    await db.claimMessage(row.id);
  } catch {
    return; // another sender claimed it
  }
  if (!mayContact(home.phone)) {
    await db.messageFailed(row.id, "number not on CONTACT_ALLOWLIST");
    return;
  }
  try {
    if (guardResidentTurn(row.body, db.residentState?.(home.id), "message").blocked) {
      await db.messageFailed(row.id, "Honesty guard blocked a stale or unverified message; review the current case before retrying");
      return;
    }
    await db.messageSent(row.id, await send(home.phone, row.body, `hackutd-message-${row.id}`));
  } catch (error) {
    if (error instanceof PhotonError && error.code === "SHARED_LINE_INBOUND_REQUIRED") return db.messageWaiting(row.id, error.message);
    await db.messageFailed(row.id, error instanceof Error ? error.message : String(error));
  }
}

// One resident's texts go out one at a time, in the order the module queued them, so a held survey
// question arrives before the reply queued behind it. Different residents still send in parallel.
export function perResident(send: (row: MessageRow) => Promise<void>) {
  const tails = new Map<bigint, Promise<void>>();
  return (row: MessageRow) => {
    const next = (tails.get(row.householdId) ?? Promise.resolve()).then(() => send(row));
    const tail = next.catch(() => undefined);
    tails.set(row.householdId, tail);
    void tail.then(() => tails.get(row.householdId) === tail && tails.delete(row.householdId));
    return next;
  };
}

// Photon's message list is eventually consistent, so each poll reaches back past the newest reply
// it has seen. Repeats are skipped here and, after a restart, by the module.
const OVERLAP_MS = 60_000;
const LOOKBACK_MS = 10 * 60_000;
const POLL_MS = 2_000;

export async function pollReplies(db: Contract, receivedSince: (since: string) => Promise<ReceivedText[]>, cursor: { since: string }, seen: Set<string>) {
  const texts = await receivedSince(cursor.since);
  for (const text of texts) {
    if (seen.has(text.id)) continue;
    await db.receiveMessage(text.from, text.text, text.id);
    seen.add(text.id);
  }
  const newest = texts.at(-1)?.createdAt;
  if (newest) cursor.since = new Date(Date.parse(newest) - OVERLAP_MS).toISOString();
}

async function main() {
  const { connect } = await import("./db"); // generated bindings load only when the service runs
  const db = await connect();
  if (env.photon.provider() === "terminal") {
    db.onQueuedMessage((row) => void deliver(db, row, async (_phone, body) => (console.log(`[photon] ${body}`), "terminal")));
    return;
  }
  const photon = photonClient(env.photon.projectId(), env.photon.projectSecret());
  const send = perResident((row) => deliver(db, row, photon.sendText));
  db.onQueuedMessage((row) => void send(row).catch((error: unknown) => console.error("[photon] delivery failed:", error)));
  const cursor = { since: new Date(Date.now() - LOOKBACK_MS).toISOString() };
  const seen = new Set<string>();
  console.log("[photon] sending queued messages and polling for replies");
  for (;;) {
    await pollReplies(db, photon.receivedSince, cursor, seen).catch((error: unknown) => console.error("[photon] poll failed:", error instanceof Error ? error.message : error));
    await sleep(POLL_MS);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
