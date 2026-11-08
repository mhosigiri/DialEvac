import { DbConnection } from "./module_bindings";
import { env } from "./env";
import type { CallbackRow, CallRow, Contract, MessageRow } from "./contract";

// The one file that touches the generated bindings (`npm run generate` writes ./module_bindings
// from the module). Everything else goes through Contract.

export const SERVICE_QUERIES = [
  "SELECT * FROM household",
  "SELECT * FROM message WHERE state = 'queued'",
  "SELECT * FROM call WHERE phase != 'ended'",
  "SELECT * FROM callback WHERE state = 'pending'",
];

export function connect(): Promise<Contract> {
  const target = { uri: env.spacetime.uri(), database: env.spacetime.database() };
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(target.uri)
      .withDatabaseName(target.database)
      .withToken(env.spacetime.token())
      .onConnect((conn) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve(contractFor(conn, target)))
          .onError((ctx) => reject(ctx.event ?? new Error("subscription failed")))
          .subscribe(SERVICE_QUERIES);
      })
      .onConnectError((_ctx, error) => reject(error))
      // A dropped connection leaves the runners deaf and every reducer call hanging, so stop loudly
      // and let the service be restarted rather than run on silently.
      .onDisconnect((_ctx, error) => {
        console.error("[db] lost the SpacetimeDB connection", error ?? "");
        process.exit(1);
      })
      .build();
  });
}

export function contractFor(conn: DbConnection, target?: { uri: string; database: string }): Contract {
  const db = conn.db;
  const r = conn.reducers;
  return {
    target,
    household: (id) => db.household.id.find(id) ?? undefined,
    call: (id) => db.call.id.find(id) ?? undefined,
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
    messageWaiting: (messageId, error) => r.messageWaiting({ messageId, error }),
    receiveMessage: (phone, body, providerId) => r.receiveMessage({ phone, body, providerId }),
    claimCall: (callId, providerId) => r.claimCall({ callId, providerId }),
    callEnded: (callId, outcome) => r.callEnded({ callId, outcome }),
    recordDigit: (callId, digit) => r.recordDigit({ callId, digit }),
    inboundCallEnded: (phone, providerId, answer) =>
      r.inboundCallEnded({ phone, providerId, choice: answer.choice, people: answer.people, oxygen: answer.oxygen }),
    recordCallTranscript: ({ providerId, callId, callbackId, phone, turns }) =>
      r.recordCallTranscript({ providerId, callId, callbackId, phone, turns }),
    recordCallAssessment: ({ callId, providerId, choice, people, oxygen }) =>
      r.recordCallAssessment({ callId, providerId, choice, people, oxygen }),
    reportCallHandoff: ({ callId, status, targetLabel, failureReason, detail }) =>
      r.reportCallHandoff({ callId, status, targetLabel, failureReason, detail }),
    updateRecord: (householdId, patch, source) =>
      r.updateRecord({
        householdId,
        patch: { canLeave: undefined, mobility: undefined, assistance: undefined, people: patch.people, oxygen: patch.oxygen },
        source,
      }),
    markCallback: (callbackId, state) => r.markCallback({ callbackId, state }),
  };
}
