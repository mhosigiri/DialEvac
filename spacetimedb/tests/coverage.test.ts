import { describe, expect, it } from "vitest";
import { TimeDuration } from "spacetimedb";
import { urgency } from "../src/domain/urgency";
import { accountFor } from "../src/domain/coverage";
import { applyZone, endCall, insertHousehold } from "../src/households";
import { heartbeat, startNight } from "../src/loop";
import { runLadderStep, sweepCoverage } from "../src/reach";
import { harness, runNight, WIDE_ZONE } from "./night";

const base = { mobility: "walks", oxygen: false, people: 1, needProbability: 0 } as const;

describe("urgency: who is reached first", () => {
  it("ranks a tighter hazard window above any needs", () => {
    expect(urgency({ ...base, minutesLeft: 25 })).toBeGreaterThan(urgency({ ...base, minutesLeft: 90, mobility: "bedbound", oxygen: true, people: 6, needProbability: 1 }));
  });
  it("within a window, ranks people who can't leave on their own first", () => {
    expect(urgency({ ...base, minutesLeft: 50, mobility: "bedbound", oxygen: true })).toBeGreaterThan(urgency({ ...base, minutesLeft: 45 }));
  });
  it("ranks by the records prior before anyone has been asked", () => {
    expect(urgency({ ...base, minutesLeft: 50, needProbability: 0.9 })).toBeGreaterThan(urgency({ ...base, minutesLeft: 50, needProbability: 0.1 }));
  });
});

describe("no one is overlooked", () => {
  it("accounts a home nobody is reaching as overlooked, and nothing else", () => {
    expect(accountFor({ canLeave: undefined, reach: "reached", request: undefined, ladderRunning: false })).toBe("overlooked");
    expect(accountFor({ canLeave: undefined, reach: "calling", request: undefined, ladderRunning: true })).toBe("reaching");
    expect(accountFor({ canLeave: true, reach: "reached", request: undefined, ladderRunning: false })).toBe("leaving_on_own");
    expect(accountFor({ canLeave: false, reach: "reached", request: { status: "received", escalation: undefined }, ladderRunning: false })).toBe("help_requested");
  });

  it("puts a home that picked up and hung up without answering back on the ladder", () => {
    const { h, tx } = harness();
    const id = tx((ctx) => {
      const home = insertHousehold(ctx, { riderId: "r1", name: "R", address: "1 Elm St", lat: 32.99, lng: -96.75, phone: "+12142000100", language: "en", mobility: "walks", assistance: "none", simulated: false });
      applyZone(ctx, WIDE_ZONE);
      startNight(ctx, "flood");
      runLadderStep(ctx, home.id, 0);
      runLadderStep(ctx, home.id, 1);
      const call = [...ctx.db.call.householdId.filter(home.id)][0];
      endCall(ctx, call.id, "answered");
      // The ladder's own rows are gone, as after a crash or a lost schedule.
      for (const step of [...ctx.db.reachStep.iter()]) ctx.db.reachStep.scheduledId.delete(step.scheduledId);
      return home.id;
    });
    const sweep = tx(sweepCoverage);
    expect(sweep.overlooked).toBe(1);
    tx((ctx) => {
      expect(ctx.db.household.id.find(id)!.reach).toBe("calling");
      expect([...ctx.db.reachStep.iter()].map((s) => s.householdId)).toContain(id);
    });
    h.clock.advance(TimeDuration.fromMillis(30_000));
    expect(tx(sweepCoverage).overlooked).toBe(0);
  });

  it("sends a home still unreached when the hazard is close to door checks, without waiting on the call queue", () => {
    const { h, tx } = harness();
    const id = tx((ctx) => {
      const home = insertHousehold(ctx, { riderId: "r2", name: "R", address: "2 Elm St", lat: 32.9857, lng: -96.7502, phone: "+12142000101", language: "en", mobility: "walks", assistance: "none", simulated: false });
      applyZone(ctx, WIDE_ZONE);
      startNight(ctx, "wildfire");
      runLadderStep(ctx, home.id, 0);
      runLadderStep(ctx, home.id, 1);
      return home.id;
    });
    h.clock.advance(TimeDuration.fromMillis(2 * 60_000));
    tx((ctx) => {
      runLadderStep(ctx, id, 2);
      expect(ctx.db.household.id.find(id)!.reach).toBe("door_check");
      heartbeat(ctx);
    });
  });
});

describe("a night at scale", () => {
  const night = { homes: 2000, callsPerSecond: 1, minutes: 75, stepSeconds: 5 };

  function outcome(order: "urgency" | "arrival") {
    const { tx } = runNight({ ...night, order });
    return tx((ctx) => {
      const sweep = sweepCoverage(ctx);
      const needy = [...ctx.db.household.inZone.filter(true)].filter((home) => home.mobility !== "walks");
      const reachedNeedy = needy.filter((home) => home.reach === "reached").length / needy.length;
      return { sweep, reachedNeedy };
    });
  }

  it("accounts for every home and calls the people who can't leave first", () => {
    const ranked = outcome("urgency");
    const arrival = outcome("arrival");
    console.log("coverage", ranked.sweep, "needy reached by phone: urgency", ranked.reachedNeedy.toFixed(2), "arrival", arrival.reachedNeedy.toFixed(2));
    expect(ranked.sweep.inZone).toBe(night.homes);
    expect(ranked.sweep.overlooked).toBe(0);
    expect(ranked.sweep.reaching).toBe(0);
    expect(ranked.reachedNeedy).toBeGreaterThan(arrival.reachedNeedy);
  }, 600_000);
});
