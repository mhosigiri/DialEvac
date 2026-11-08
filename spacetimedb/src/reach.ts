import { spacetimedb, reachStep } from "./schema";
import { accountFor, ACCOUNTS, type Account } from "./domain/coverage";
import { audit, minutesLeft, queueMessage, runAt, urgencyOf, type Household, type Tx } from "./core";
import { SURVEY_ASK, SURVEY_INTRO } from "./domain/script";

// Silence never counts as safe. Each home in the zone gets a survey text at once (texts go out in
// parallel), then a call, retries at 2 and 5 minutes, then the door-check list for field teams.
// Calls are paced, so a step waits while the home's last call is still queued or ringing. When
// the hazard is close and the home is still unreached, it goes to door checks without waiting.
// Each step is a scheduled row, so a restart resumes the ladder.

const STEPS = [
  { kind: "message", afterSeconds: 0 },
  { kind: "call", afterSeconds: 0 },
  { kind: "call", afterSeconds: 120 },
  { kind: "call", afterSeconds: 300 },
  { kind: "door_check", afterSeconds: 300 },
] as const;

const WAIT_FOR_CALL_SECONDS = 15;
const DOOR_CHECK_LEAD_MINUTES = 25;
const OPEN_CALL = ["queued", "ringing", "live"];

export function startReachLadder(tx: Tx, home: Household) {
  if (home.reach !== "idle") return;
  tx.db.household.id.update({ ...home, reach: "calling" });
  tx.db.reachStep.insert({ scheduledId: 0n, scheduledAt: runAt(tx, 0), householdId: home.id, step: 0 });
}

const hasOpenCall = (tx: Tx, householdId: bigint) => [...tx.db.call.householdId.filter(householdId)].some((c) => OPEN_CALL.includes(c.phase));

function sendToDoorCheck(tx: Tx, home: Household, why: string) {
  tx.db.household.id.update({ ...home, reach: "door_check" });
  audit(tx, "door_check", `${home.address}: ${why}`);
}

export function runLadderStep(tx: Tx, householdId: bigint, stepIndex: number) {
  const home = tx.db.household.id.find(householdId);
  if (!home || home.reach !== "calling" || !home.inZone) return;
  const step = STEPS[stepIndex];
  if (!step) return;
  if (minutesLeft(tx, home) <= DOOR_CHECK_LEAD_MINUTES) return sendToDoorCheck(tx, home, "hazard close and still unreached");
  if (step.kind !== "message" && hasOpenCall(tx, home.id)) {
    tx.db.reachStep.insert({ scheduledId: 0n, scheduledAt: runAt(tx, WAIT_FOR_CALL_SECONDS), householdId, step: stepIndex });
    return;
  }
  if (step.kind === "door_check") return sendToDoorCheck(tx, home, "unreached after a text and three calls");
  if (step.kind === "message") queueMessage(tx, home.id, `${SURVEY_INTRO} ${SURVEY_ASK}`);
  else {
    tx.db.call.insert({
      id: 0n,
      householdId: home.id,
      purpose: "survey",
      phase: "queued",
      attempt: stepIndex,
      priority: urgencyOf(tx, home),
      outcome: undefined,
      providerId: undefined,
      queuedAt: tx.timestamp,
      endedAt: undefined,
    });
  }
  const next = STEPS[stepIndex + 1];
  if (next) tx.db.reachStep.insert({ scheduledId: 0n, scheduledAt: runAt(tx, next.afterSeconds), householdId, step: stepIndex + 1 });
}

export const runReachStep = spacetimedb.reducer({ onSchedule: reachStep }, { timer: reachStep.rowType }, (ctx, { timer }) =>
  runLadderStep(ctx, timer.householdId, timer.step),
);

// Accounts for every home in the zone and restarts the ladder for any home nobody is reaching.
// "Reached" alone is not safe: a home that picked up and hung up without answering, or whose
// record was edited without saying whether they can leave, is overlooked until someone asks.
export function sweepCoverage(tx: Tx) {
  const laddering = new Set([...tx.db.reachStep.iter()].map((s) => s.householdId));
  for (const c of tx.db.call.iter()) if (OPEN_CALL.includes(c.phase)) laddering.add(c.householdId);
  const counts = Object.fromEntries(ACCOUNTS.map((a) => [a, 0])) as Record<Account, number>;
  for (const home of tx.db.household.inZone.filter(true)) {
    const request = tx.db.request.householdId.find(home.id) ?? undefined;
    const account = accountFor({ canLeave: home.canLeave, reach: home.reach, request, ladderRunning: laddering.has(home.id) });
    counts[account] += 1;
    if (account === "overlooked") {
      startReachLadder(tx, tx.db.household.id.update({ ...home, reach: "idle" }));
      audit(tx, "coverage", `${home.address} was not being reached: ladder restarted`);
    }
  }
  const row = {
    id: 0,
    at: tx.timestamp,
    inZone: Object.values(counts).reduce((sum, n) => sum + n, 0),
    leavingOnOwn: counts.leaving_on_own,
    helped: counts.helped,
    helpRequested: counts.help_requested,
    escalated: counts.escalated,
    doorCheck: counts.door_check,
    reaching: counts.reaching,
    overlooked: counts.overlooked,
  };
  if (tx.db.coverage.id.find(0)) tx.db.coverage.id.update(row);
  else tx.db.coverage.insert(row);
  return row;
}
