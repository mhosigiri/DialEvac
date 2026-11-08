import type { CaseAction } from "./lib/cases";

// What a dispatcher can actually send. "driver_response" splits into the two answers a driver can
// give, and the actions with nothing to send drop out.
export type Command =
  | Extract<CaseAction, { kind: "dispatch" | "approve" | "close" }>
  | { kind: "accept" | "decline" | "route"; assignmentId: bigint }
  | { kind: "notify"; requestId: bigint };

const textOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The module rejects an ungranted identity with "Not authorized: ..." (spacetimedb/src/authorization.ts).
export function isNotAuthorized(error: unknown) {
  return textOf(error).includes("Not authorized");
}

export function failureMessage(error: unknown) {
  const text = textOf(error);
  if (text.includes("changed")) return "This case changed before your action landed. Check its current state and try again.";
  return text;
}
