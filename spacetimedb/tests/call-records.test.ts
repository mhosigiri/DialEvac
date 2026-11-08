import { it, expect } from "vitest";
import { TimeDuration } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as exports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedHoustonVoiceStory } from "../src/houston-demo";

const turns = [{ speaker: "agent", text: "What do you need?" }, { speaker: "resident", text: "There are two of us. I use a wheelchair." }];
function fixture() {
  const h = createModuleTestHarness(spacetimedb, exports);
  const tx = <T>(body: (ctx: Parameters<typeof exports.recordProviderCall>[0]) => T) => h.withReducerTx(TestAuth.internal(), body);
  const input = { providerId: "conv-archive", agentId: "agent-test", callId: undefined, callbackId: undefined, householdId: undefined as bigint | undefined,
    direction: "inbound", status: "done", callerLabel: "Caller ending 5303", startedAt: undefined, durationSeconds: 90, turns };
  return { h, tx, input };
}

it("retains unknown callers and transcripts once, independently of a household or job", () => {
  const { h, tx, input } = fixture();
  tx(ctx => exports.recordProviderCall(ctx, input));
  tx(ctx => exports.recordProviderCall(ctx, input));
  expect(h.db.callRecord.count()).toBe(1n);
  expect(h.db.callRecord.providerId.find(input.providerId)).toMatchObject({ householdId: undefined, callId: undefined, turns });
  expect(h.db.callAnalysis.providerId.find(input.providerId)).toMatchObject({ state: "pending", attempts: 0 });
  expect(h.db.household.count()).toBe(0n);
});

it("atomically links a matched inbound call and writes the existing transcript table without sending outreach", () => {
  const { h, tx, input } = fixture();
  tx(ctx => seedHoustonVoiceStory(ctx, "flood"));
  const home = [...h.db.household.iter()][0];
  input.householdId = home.id;
  tx(ctx => exports.recordProviderCall(ctx, input));
  tx(ctx => exports.recordProviderCall(ctx, input));
  const archive = h.db.callRecord.providerId.find(input.providerId)!;
  expect(h.db.call.id.find(archive.callId!)).toMatchObject({ householdId: home.id, purpose: "inbound", phase: "ended", providerId: input.providerId });
  expect([...h.db.transcriptLine.callId.filter(archive.callId!)].map(line => ({ speaker: line.speaker, text: line.text }))).toEqual(turns);
  expect(h.db.message.count()).toBe(0n);
  expect(h.db.callback.count()).toBe(0n);
});

it("retains failed/no-transcript calls and unresolved old job IDs", () => {
  const { h, tx, input } = fixture();
  tx(ctx => exports.recordProviderCall(ctx, { ...input, status: "failed", direction: "outbound", callId: 999n, turns: [] }));
  expect(h.db.callRecord.providerId.find(input.providerId)).toMatchObject({ status: "failed", turns: [] });
  expect(h.db.callAnalysis.providerId.find(input.providerId)?.state).toBe("no_transcript");
});

it("does not let partial/replayed provider updates erase a completed transcript or Claude result", () => {
  const { h, tx, input } = fixture();
  tx(ctx => exports.recordProviderCall(ctx, { ...input, status: "processing", turns: turns.slice(0, 1) }));
  tx(ctx => exports.recordProviderCall(ctx, input));
  const complete = h.db.callRecord.providerId.find(input.providerId)!;
  tx(ctx => exports.recordProviderCall(ctx, { ...input, status: "processing", turns: [] }));
  expect(h.db.callRecord.providerId.find(input.providerId)).toEqual(complete);
  expect(complete.revision).toBe(2n);
});

it("leases analysis, rejects fabricated evidence, and ignores late results after a new worker claims", () => {
  const { h, tx, input } = fixture();
  tx(ctx => exports.recordProviderCall(ctx, input));
  const claim = { providerId: input.providerId, revision: 1n, claimToken: "first" };
  tx(ctx => exports.claimCallAnalysis(ctx, claim));
  expect(() => tx(ctx => exports.claimCallAnalysis(ctx, { ...claim, claimToken: "second" }))).toThrow(/claimed/);
  const result = { summary: "The caller reports needing assistance.", priority: "high", priorityReason: "Caller reports wheelchair use.",
    facts: [{ fact: "Wheelchair user", turn: 1, quote: "I use a wheelchair." }], unknowns: ["Pickup location"], recommendedActions: ["Confirm pickup location"] };
  expect(() => tx(ctx => exports.finishCallAnalysis(ctx, { ...claim, model: "claude-test", resultJson: JSON.stringify({ ...result, facts: [{ fact: "invented", turn: 1, quote: "made up" }] }), error: undefined }))).toThrow(/evidence/);
  h.clock.advance(TimeDuration.fromMillis(121_000));
  tx(ctx => exports.claimCallAnalysis(ctx, { ...claim, claimToken: "second" }));
  tx(ctx => exports.finishCallAnalysis(ctx, { ...claim, model: "claude-test", resultJson: JSON.stringify(result), error: undefined }));
  expect(h.db.callAnalysis.providerId.find(input.providerId)?.state).toBe("analyzing");
  tx(ctx => exports.finishCallAnalysis(ctx, { ...claim, claimToken: "second", model: "claude-test", resultJson: JSON.stringify(result), error: undefined }));
  expect(h.db.callAnalysis.providerId.find(input.providerId)).toMatchObject({ state: "ready", attempts: 2, resultJson: JSON.stringify(result) });
});

it("schedules failed analyses for retry without losing transcripts and permits an operator retry", () => {
  const { h, tx, input } = fixture();
  tx(ctx => exports.recordProviderCall(ctx, input));
  const claim = { providerId: input.providerId, revision: 1n, claimToken: "test" };
  tx(ctx => exports.claimCallAnalysis(ctx, claim));
  tx(ctx => exports.finishCallAnalysis(ctx, { ...claim, model: "claude-test", resultJson: undefined, error: "Claude analysis request failed (HTTP 429)" }));
  expect(h.db.callAnalysis.providerId.find(input.providerId)?.state).toBe("failed");
  expect(() => tx(ctx => exports.claimCallAnalysis(ctx, claim))).toThrow(/not due/);
  tx(ctx => exports.retryCallAnalysis(ctx, { providerId: input.providerId }));
  tx(ctx => exports.claimCallAnalysis(ctx, claim));
  expect(h.db.callRecord.providerId.find(input.providerId)?.turns).toEqual(turns);
});
