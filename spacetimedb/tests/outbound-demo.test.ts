import { it, expect } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as exports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedHoustonVoiceStory } from "../src/houston-demo";

function fixture() {
  const h = createModuleTestHarness(spacetimedb, exports);
  const tx = <T>(body: (ctx: Parameters<typeof exports.startDemoOutboundAttempt>[0]) => T) => h.withReducerTx(TestAuth.internal(), ctx => body(new Proxy(ctx, {
    get: (target, key) => key === "env" ? { DEMO_MODE: "isolated" } : Reflect.get(target, key, target),
  })));
  tx(ctx => seedHoustonVoiceStory(ctx, "hurricane"));
  return { h, tx };
}

it("atomically consumes one attempt and never resets or reuses previous survey history", () => {
  const { h, tx } = fixture(); const original = [...h.db.call.iter()][0];
  tx(ctx => exports.startDemoOutboundAttempt(ctx, { attemptId: "judges-01" }));
  const receipt = h.db.outboundDemoAttempt.attemptId.find("judges-01")!;
  expect(h.db.call.id.find(receipt.callId)).toMatchObject({ phase: "ringing", purpose: "survey", providerId: "elevenlabs" });
  expect(() => tx(ctx => exports.startDemoOutboundAttempt(ctx, { attemptId: "judges-01" }))).toThrow(/consumed/);
  expect(h.db.call.id.find(original.id)).toEqual(original);
  expect(h.db.call.count()).toBe(2n);
  expect(h.db.message.count()).toBe(0n);
});

it("prevents concurrent calls but allows a separately named attempt after the previous one ends", () => {
  const { h, tx } = fixture();
  tx(ctx => exports.startDemoOutboundAttempt(ctx, { attemptId: "first" }));
  expect(() => tx(ctx => exports.startDemoOutboundAttempt(ctx, { attemptId: "second" }))).toThrow(/in progress/);
  expect(h.db.outboundDemoAttempt.attemptId.find("second")).toBeNull();
  const callId = h.db.outboundDemoAttempt.attemptId.find("first")!.callId;
  tx(ctx => exports.callEnded(ctx, { callId, outcome: "failed" }));
  tx(ctx => exports.startDemoOutboundAttempt(ctx, { attemptId: "second" }));
  expect(h.db.outboundDemoAttempt.count()).toBe(2n);
});

it("rejects unsafe attempt names and use outside the opted-in isolated database", () => {
  const { h, tx } = fixture();
  expect(() => tx(ctx => exports.startDemoOutboundAttempt(ctx, { attemptId: "invalid / attempt" }))).toThrow(/alphanumeric/);
  expect(() => h.withReducerTx(TestAuth.internal(), ctx => exports.startDemoOutboundAttempt(new Proxy(ctx, { get: (t, key) => key === "env" ? {} : Reflect.get(t, key, t) }), { attemptId: "disabled" }))).toThrow(/disabled/);
  expect(h.db.outboundDemoAttempt.count()).toBe(0n);
});
