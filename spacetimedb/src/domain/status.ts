// Every request and offer status, and the only moves between them. Reducers call `moveRequest`;
// nothing else writes a status, so the agent's lines (honesty.ts) always match the truth.

export const REQUEST_STATUSES = [
  "received",
  "approved",
  "driver_accepted",
  "en_route",
  "arrived",
  "closed",
  "reassigning",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  "proposed",
  "offered",
  "accepted",
  "declined",
  "expired",
  "replaced",
  "revoked",
  "cancelled",
  "completed",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const OPEN_OFFER: readonly AssignmentStatus[] = ["proposed", "offered"];
export const LIVE_ASSIGNMENT: readonly AssignmentStatus[] = ["proposed", "offered", "accepted"];

const REQUEST_MOVES: Record<RequestStatus, readonly RequestStatus[]> = {
  received: ["approved", "reassigning", "closed"],
  approved: ["received", "driver_accepted", "closed"],
  driver_accepted: ["en_route", "reassigning", "arrived", "closed"],
  en_route: ["arrived", "reassigning", "closed"],
  arrived: ["closed"],
  closed: [],
  reassigning: ["approved", "driver_accepted", "received", "closed"],
};

export function canMove(from: RequestStatus, to: RequestStatus) {
  return from === to || REQUEST_MOVES[from].includes(to);
}

export function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isAssignmentStatus(value: string): value is AssignmentStatus {
  return (ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

// A rider is called only about a driver who accepted, and about losing one.
export const ANNOUNCED: readonly RequestStatus[] = ["driver_accepted", "reassigning"];

export const ESCALATIONS = ["medical", "hazard_at_home", "address_unconfirmed", "language_barrier", "unservable"] as const;
export type Escalation = (typeof ESCALATIONS)[number];
