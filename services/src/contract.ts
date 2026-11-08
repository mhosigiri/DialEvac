// What the services read and write in SpacetimeDB. db.ts implements it over the generated client
// bindings; the runners depend only on this, so they typecheck and test without a live database.

export type HouseholdRow = { id: bigint; phone: string; language: string; name: string };
export type MessageRow = { id: bigint; householdId: bigint; direction: string; state: string; body: string };
export type CallRow = { id: bigint; householdId: bigint; purpose: string; phase: string; priority: number; providerId?: string };
export type CallbackRow = { id: bigint; householdId: bigint; state: string; line: string };

export interface Contract {
  household(id: bigint): HouseholdRow | undefined;
  call(id: bigint): CallRow | undefined;
  findCallByProvider(providerId: string): CallRow | undefined;
  callback(id: bigint): CallbackRow | undefined;
  // Each fires for rows already in that state when the subscription applies, then for new ones.
  onQueuedMessage(handler: (row: MessageRow) => void): void;
  onQueuedCall(handler: (row: CallRow) => void): void;
  onPendingCallback(handler: (row: CallbackRow) => void): void;

  claimMessage(messageId: bigint): Promise<void>;
  messageSent(messageId: bigint, providerId: string): Promise<void>;
  messageFailed(messageId: bigint, error: string): Promise<void>;
  receiveMessage(phone: string, body: string, providerId: string): Promise<void>;
  claimCall(callId: bigint, providerId: string): Promise<void>;
  callAnswered(callId: bigint): Promise<void>;
  callEnded(callId: bigint, outcome: string): Promise<void>;
  recordDigit(callId: bigint, digit: string): Promise<void>;
  // A resident called in: the module finds the home by phone. choice is "" when they gave no clear answer.
  inboundCallEnded(phone: string, providerId: string, answer: { choice: string; people?: number; oxygen?: boolean }): Promise<void>;
  updateRecord(householdId: bigint, patch: { people?: number; oxygen?: boolean }, source: string): Promise<void>;
  markCallback(callbackId: bigint, state: "placed" | "played" | "unanswered"): Promise<void>;
}
