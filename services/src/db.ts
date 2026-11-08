import { DbConnection } from "./module_bindings";
import { env } from "./env";
import type { CallbackRow, CallRow, Contract, MessageRow } from "./contract";

// The one file that touches the generated bindings (`npm run generate` writes ./module_bindings
// from the module). Everything else goes through Contract.

const QUERIES = [
  "SELECT * FROM household",
  "SELECT * FROM message WHERE state = 'queued'",
  "SELECT * FROM call WHERE phase != 'ended'",
  "SELECT * FROM callback WHERE state = 'pending'",
];

export function connect(): Promise<Contract> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(env.spacetime.uri())
      .withDatabaseName(env.spacetime.database())
      .withToken(env.spacetime.token())
      .onConnect((conn) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve(contractFor(conn)))
          .onError((ctx) => reject(ctx.event ?? new Error("subscription failed")))
          .subscribe(QUERIES);
      })
      .onConnectError((_ctx, error) => reject(error))
      .build();
  });
}

function contractFor(conn: DbConnection): Contract {
  const db = conn.db;
  const r = conn.reducers;
  return {
    household: (id) => db.household.id.find(id) ?? undefined,
    call: (id) => db.call.id.find(id) ?? undefined,
    findCallByProvider: (providerId) => [...db.call.iter()].find((c) => c.providerId === providerId),
    callback: (id) => db.callback.id.find(id) ?? undefined,
    onQueuedMessage(handler) {
      for (const row of db.message.iter()) if (row.state === "queued") handler(row as MessageRow);
      db.message.onInsert((_ctx, row) => row.state === "queued" && handler(row as MessageRow));
    },
    onQueuedCall(handler) {
      for (const row of db.call.iter()) if (row.phase === "queued") handler(row as CallRow);
      db.call.onInsert((_ctx, row) => row.phase === "queued" && handler(row as CallRow));
    },
    onPendingCallback(handler) {
      for (const row of db.callback.iter()) if (row.state === "pending") handler(row as CallbackRow);
      db.callback.onInsert((_ctx, row) => row.state === "pending" && handler(row as CallbackRow));
    },
    claimMessage: (messageId) => r.claimMessage({ messageId }),
    messageSent: (messageId, providerId) => r.messageSent({ messageId, providerId }),
    messageFailed: (messageId, error) => r.messageFailed({ messageId, error }),
    receiveMessage: (phone, body, providerId) => r.receiveMessage({ phone, body, providerId }),
    claimCall: (callId, providerId) => r.claimCall({ callId, providerId }),
    callAnswered: (callId) => r.callAnswered({ callId }),
    callEnded: (callId, outcome) => r.callEnded({ callId, outcome }),
    recordDigit: (callId, digit) => r.recordDigit({ callId, digit }),
    inboundCallEnded: (phone, providerId, answer) =>
      r.inboundCallEnded({ phone, providerId, choice: answer.choice, people: answer.people, oxygen: answer.oxygen }),
    updateRecord: (householdId, patch, source) =>
      r.updateRecord({
        householdId,
        patch: { canLeave: undefined, mobility: undefined, assistance: undefined, people: patch.people, oxygen: patch.oxygen },
        source,
      }),
    markCallback: (callbackId, state) => r.markCallback({ callbackId, state }),
  };
}
