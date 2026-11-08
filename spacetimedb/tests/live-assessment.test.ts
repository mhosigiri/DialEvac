import { describe, expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedAssistanceStory } from "../src/demos";

type Context = Parameters<typeof moduleExports.callAnswered>[0];
type Answer = { callId: bigint; providerId: string; choice: string; people?: number; oxygen?: boolean };
const assess = (ctx: Context, answer: Answer) => moduleExports.recordCallAssessment(ctx, { ...answer, people: answer.people, oxygen: answer.oxygen });
function fixture() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  const tx = <T>(body: (ctx: Context) => T) => h.withReducerTx(TestAuth.internal(), body);
  tx(seedAssistanceStory);
  const home = [...h.db.household.iter()].find(h => h.riderId === "demo-richardson-wheelchair")!;
  const callId = tx(ctx => ctx.db.call.insert({ id: 0n, householdId: home.id, purpose: "survey", phase: "ringing", attempt: 1,
    priority: 1, outcome: undefined, providerId: "elevenlabs", queuedAt: ctx.timestamp, endedAt: undefined }).id);
  return { h, tx, home, callId };
}

describe("assessment arrives before a live call ends", () => {
  it("atomically updates the household and request while retaining the active call for human transfer", () => {
    const { h, tx, home, callId } = fixture();
    const answer = { callId, providerId: "conv-live", choice: "3", people: 3, oxygen: true };
    tx(ctx => assess(ctx, answer));
    const corrections = h.db.correction.count();
    tx(ctx => assess(ctx, answer));
    expect(h.db.household.id.find(home.id)).toMatchObject({ people: 3, oxygen: true, mobility: "wheelchair", canLeave: false });
    expect(h.db.request.householdId.find(home.id)).toMatchObject({ people: 3, oxygen: true, mobility: "wheelchair" });
    expect(h.db.call.id.find(callId)).toMatchObject({ phase: "live", providerId: "conv-live", endedAt: undefined });
    expect(h.db.correction.count()).toBe(corrections);
    expect(h.db.transcriptLine.count()).toBe(0n); // Final conversation ingestion remains the transcript writer.
  });

  it("rejects invalid answers without partially updating the record", () => {
    const { h, tx, home, callId } = fixture();
    const before = h.db.household.id.find(home.id);
    for (const answer of [{ choice: "unknown", people: 3 }, { choice: "2", people: 0 }, { choice: "2", people: 50 }]) {
      expect(() => tx(ctx => assess(ctx, { callId, providerId: "conv-live", ...answer }))).toThrow(/answer|people/);
      expect(h.db.household.id.find(home.id)).toEqual(before);
      expect(h.db.call.id.find(callId)?.phase).toBe("ringing");
    }
  });

  it("does not let late tools revive ended calls or relink a different conversation", () => {
    const { h, tx, callId } = fixture();
    tx(ctx => assess(ctx, { callId, providerId: "conv-live", choice: "2" }));
    expect(() => tx(ctx => assess(ctx, { callId, providerId: "conv-other", choice: "3" }))).toThrow(/conversation/);
    tx(ctx => moduleExports.callEnded(ctx, { callId, outcome: "answered" }));
    expect(() => tx(ctx => assess(ctx, { callId, providerId: "conv-live", choice: "3" }))).toThrow(/active/);
    expect(h.db.call.id.find(callId)?.phase).toBe("ended");
  });
});
