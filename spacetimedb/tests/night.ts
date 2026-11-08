import { TimeDuration, Timestamp } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { applyRecord, applyZone, endCall } from "../src/households";
import { heartbeat, seedTown, startNight } from "../src/loop";
import { runLadderStep } from "../src/reach";
import { control, type Tx } from "../src/core";

// A whole simulated night in the test harness, with the test playing the scheduler and a paced voice
// service: each step it places the highest-priority queued calls (or the oldest, for comparison).

export const WIDE_ZONE: [number, number][][] = [[[-97.0, 32.8], [-96.5, 32.8], [-96.5, 33.2], [-97.0, 33.2], [-97.0, 32.8]]];

export function harness() {
  const h = createModuleTestHarness(spacetimedb, moduleExports, { rngSeed: 7 });
  h.clock.set(Timestamp.fromDate(new Date("2026-11-08T03:25:00Z")));
  const tx = <T>(body: (ctx: Tx) => T) => h.withReducerTx(TestAuth.internal(), body);
  return { h, tx };
}

export type NightOptions = { homes: number; callsPerSecond: number; order: "urgency" | "arrival"; minutes: number; stepSeconds: number };

export function runNight({ homes, callsPerSecond, order, minutes, stepSeconds }: NightOptions) {
  const { h, tx } = harness();
  tx((ctx) => {
    seedTown(ctx, homes);
    ctx.db.control.id.update({ ...control(ctx), simulateVoice: false, simulateDispatch: true });
    applyZone(ctx, WIDE_ZONE);
    startNight(ctx, "wildfire");
  });
  for (let elapsed = 0; elapsed < minutes * 60; elapsed += stepSeconds) {
    h.clock.advance(TimeDuration.fromMillis(stepSeconds * 1000));
    tx((ctx) => {
      runDueLadderSteps(ctx);
      placeCalls(ctx, callsPerSecond * stepSeconds, order);
      heartbeat(ctx);
    });
  }
  return { h, tx };
}

function runDueLadderSteps(tx: Tx) {
  const now = tx.timestamp.microsSinceUnixEpoch;
  const due = [...tx.db.reachStep.iter()].filter((s) => s.scheduledAt.tag === "Time" && s.scheduledAt.value.microsSinceUnixEpoch <= now);
  for (const step of due) {
    tx.db.reachStep.scheduledId.delete(step.scheduledId);
    runLadderStep(tx, step.householdId, step.step);
  }
}

// Three in four simulated homes answer; their seeded mobility is the truth.
function placeCalls(tx: Tx, capacity: number, order: NightOptions["order"]) {
  const queued = [...tx.db.call.phase.filter("queued")];
  queued.sort(order === "urgency" ? (a, b) => b.priority - a.priority : (a, b) => Number(a.queuedAt.microsSinceUnixEpoch - b.queuedAt.microsSinceUnixEpoch));
  for (const call of queued.slice(0, capacity)) {
    const home = tx.db.household.id.find(call.householdId)!;
    if (tx.random() < 0.25) {
      endCall(tx, call.id, "no_answer");
      continue;
    }
    applyRecord(tx, home, { canLeave: home.mobility === "walks" && tx.random() < 0.7, people: home.people }, "voice");
    endCall(tx, call.id, "answered");
  }
}
