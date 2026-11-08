import { describe, expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as exports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedAssistanceStory } from "../src/demos";

type Context = Parameters<typeof exports.inboundCallEnded>[0];
type Input = { providerId: string; callId?: bigint; callbackId?: bigint; phone?: string; turns: { speaker: string; text: string }[] };
const ingest = (ctx: Context, args: Input) => exports.recordCallTranscript(ctx, { ...args, callId: args.callId, callbackId: args.callbackId, phone: args.phone });
const turns = [{ speaker: "agent", text: "Can you leave?" }, { speaker: "resident", text: "I need a ride." }, { speaker: "resident", text: "I need a ride." }];
function fixture() {
  const h = createModuleTestHarness(spacetimedb, exports);
  const tx = <T>(fn: (ctx: Context) => T) => h.withReducerTx(TestAuth.internal(), fn);
  tx(seedAssistanceStory);
  const home = tx(ctx => [...ctx.db.household.iter()].find(h => h.riderId === "demo-richardson-wheelchair")!);
  return { h, tx, home };
}

describe("transactional conversation transcripts", () => {
  it("ingests outbound turns once across retries, preserving repeated identical utterances", () => {
    const { tx, home } = fixture();
    const id = tx(ctx => ctx.db.call.insert({ id: 0n, householdId: home.id, purpose: "survey", phase: "ended", attempt: 1,
      priority: 1, outcome: "answered", providerId: "elevenlabs", queuedAt: ctx.timestamp, endedAt: ctx.timestamp }).id);
    tx(ctx => ingest(ctx, { providerId: "conv-outbound", callId: id, turns }));
    tx(ctx => ingest(ctx, { providerId: "conv-outbound", callId: id, turns }));
    tx(ctx => {
      expect([...ctx.db.transcriptLine.callId.filter(id)].map(line => ({ speaker: line.speaker, text: line.text }))).toEqual(turns);
      expect(ctx.db.call.id.find(id)?.providerId).toBe("conv-outbound");
    });
  });

  it("links inbound turns by conversation and phone after inboundCallEnded, without a supplied call id", () => {
    const { tx, home } = fixture();
    const answer = { phone: home.phone, providerId: "conv-inbound", choice: "3", people: undefined, oxygen: undefined };
    for (let attempt = 0; attempt < 2; attempt++) {
      tx(ctx => exports.inboundCallEnded(ctx, answer));
      tx(ctx => ingest(ctx, { providerId: answer.providerId, phone: home.phone, turns }));
    }
    tx(ctx => {
      const calls = [...ctx.db.call.householdId.filter(home.id)].filter(c => c.providerId === answer.providerId);
      expect(calls).toHaveLength(1);
      expect(calls[0].phase).toBe("ended");
      expect([...ctx.db.transcriptLine.callId.filter(calls[0].id)]).toHaveLength(turns.length);
    });
  });

  it("records callback conversation turns against a call for the callback's household", () => {
    const { tx, home } = fixture();
    const callbackId = tx(ctx => ctx.db.callback.insert({ id: 0n, key: "test-cb", householdId: home.id,
      requestId: ctx.db.request.householdId.find(home.id)!.id, assignmentId: undefined, status: "driver_accepted", line: "Test", state: "placed", at: ctx.timestamp }).id);
    tx(ctx => ingest(ctx, { providerId: "conv-callback", callbackId, turns }));
    tx(ctx => ingest(ctx, { providerId: "conv-callback", callbackId, turns }));
    tx(ctx => {
      const calls = [...ctx.db.call.householdId.filter(home.id)].filter(c => c.providerId === "conv-callback");
      expect(calls).toHaveLength(1);
      expect(calls[0].purpose).toBe("callback");
      expect([...ctx.db.transcriptLine.callId.filter(calls[0].id)]).toHaveLength(turns.length);
    });
  });

  it("rolls back invalid turns and allows a corrected retry without partial inserts", () => {
    const { tx, home } = fixture();
    tx(ctx => exports.inboundCallEnded(ctx, { phone: home.phone, providerId: "conv-atomic", choice: "", people: undefined, oxygen: undefined }));
    expect(() => tx(ctx => ingest(ctx, { providerId: "conv-atomic", phone: home.phone, turns: [...turns, { speaker: "user", text: "invalid role" }] }))).toThrow(/speaker/);
    tx(ctx => expect(ctx.db.transcriptLine.count()).toBe(0n));
    tx(ctx => ingest(ctx, { providerId: "conv-atomic", phone: home.phone, turns }));
    tx(ctx => expect(ctx.db.transcriptLine.count()).toBe(BigInt(turns.length)));
  });

  it("cannot relink an already ingested conversation to another call", () => {
    const { tx, home } = fixture();
    const makeCall = (ctx: Context) => ctx.db.call.insert({ id: 0n, householdId: home.id, purpose: "survey", phase: "ended", attempt: 1,
      priority: 1, outcome: "answered", providerId: undefined, queuedAt: ctx.timestamp, endedAt: ctx.timestamp }).id;
    const first = tx(makeCall), second = tx(makeCall);
    tx(ctx => ingest(ctx, { providerId: "conv-conflict", callId: first, turns }));
    expect(() => tx(ctx => ingest(ctx, { providerId: "conv-conflict", callId: second, turns }))).toThrow(/another call/);
    tx(ctx => expect([...ctx.db.transcriptLine.callId.filter(second)]).toHaveLength(0));
  });
});
