// Every home in the zone is accounted for in exactly one of these. "overlooked" is the one that must
// stay at zero: in the zone, not known safe, no help under way, and nobody trying to reach them.

export const ACCOUNTS = ["leaving_on_own", "helped", "help_requested", "escalated", "door_check", "reaching", "overlooked"] as const;
export type Account = (typeof ACCOUNTS)[number];

export type AccountInputs = {
  canLeave: boolean | undefined;
  reach: string;
  request: { status: string; escalation: string | undefined } | undefined;
  ladderRunning: boolean;
};

export function accountFor({ canLeave, reach, request, ladderRunning }: AccountInputs): Account {
  if (canLeave === true) return "leaving_on_own";
  if (request?.status === "closed") return "helped";
  if (request?.escalation) return "escalated";
  if (request) return "help_requested";
  if (reach === "door_check") return "door_check";
  if (ladderRunning) return "reaching";
  return "overlooked";
}
