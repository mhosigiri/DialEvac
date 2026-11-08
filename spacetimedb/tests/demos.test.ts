import { describe, expect, it } from "vitest";
import { ConnectionId, Timestamp } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { control, type Tx } from "../src/core";
import { seedAssistanceDemo, advanceAssistanceDemo, DEMO_WHEELCHAIR } from "../src/demos";
import { insertHousehold } from "../src/households";

// The module harness does not implement env_get. Supply the host environment on this context only.
type Context = Parameters<typeof moduleExports.seedTornadoDemo>[0];
function environment(ctx: Context, mode?: string): Context {
  return new Proxy(ctx, { get: (target, key, receiver) => key === "env" ? { DEMO_MODE: mode } : Reflect.get(target, key, receiver) });
}

function harness() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  h.clock.set(Timestamp.fromDate(new Date("2026-11-08T03:25:00Z")));
  const auth = TestAuth.fromJwtPayload(JSON.stringify({ iss: "test", sub: "map-viewer" }), new ConnectionId(1n));
  const tx = <T>(body: (ctx: Tx) => T) => h.withReducerTx(TestAuth.internal(), body);
  return { h, tx, auth };
}

describe("server-side demo isolation", () => {
  it("rejects every public fixture operation without altering an active incident", () => {
    const { h, tx, auth } = harness();
    tx(ctx => ctx.db.control.id.update({ ...control(ctx), warningAt: ctx.timestamp, simulateDispatch: true }));
    const operations = [
      (ctx: Context) => moduleExports.seedStandInTown(ctx, { homes: 10 }),
      (ctx: Context) => moduleExports.seedTornadoDemo(ctx, {}),
      (ctx: Context) => seedAssistanceDemo(ctx, {}),
      (ctx: Context) => advanceAssistanceDemo(ctx, { phase: "accept" }),
      (ctx: Context) => moduleExports.replayWarning(ctx, { phase: "appear" }),
      (ctx: Context) => moduleExports.seedHoustonVoiceDemo(ctx, { hazard: "hurricane" }),
    ];
    for (const operation of operations) {
      expect(() => h.withReducerTx(auth, ctx => operation(environment(ctx)))).toThrow("Demo operations are disabled");
    }
    tx(ctx => {
      expect(control(ctx).warningAt).toBeDefined();
      expect(control(ctx).simulateDispatch).toBe(true);
      expect(ctx.db.household.count()).toBe(0n);
      expect(ctx.db.zone.count()).toBe(0n);
      expect(ctx.db.roadClosure.count()).toBe(0n);
    });
  });

  it("refuses an opted-in database containing a real household", () => {
    const { h, tx, auth } = harness();
    tx(ctx => insertHousehold(ctx, { riderId: "real", name: "Resident", address: "1 Elm St", lat: 32.98, lng: -96.75, phone: "+12145550199", language: "en", mobility: "walks", assistance: "none", simulated: false }));
    expect(() => h.withReducerTx(auth, ctx => seedAssistanceDemo(environment(ctx, "isolated"), {}))).toThrow("only simulated");
    tx(ctx => {
      expect(ctx.db.household.count()).toBe(1n);
      expect(ctx.db.vehicle.count()).toBe(0n);
      expect(ctx.db.request.count()).toBe(0n);
    });
  });

  it("leaves an existing simulated incident running even when demos are enabled", () => {
    const { h, tx, auth } = harness();
    tx(ctx => ctx.db.control.id.update({ ...control(ctx), warningAt: ctx.timestamp, simulateDispatch: true }));
    expect(() => h.withReducerTx(auth, ctx => seedAssistanceDemo(environment(ctx, "isolated"), {}))).toThrow("An incident is active");
    tx(ctx => {
      expect(control(ctx).warningAt).toBeDefined();
      expect(control(ctx).simulateDispatch).toBe(true);
      expect(ctx.db.household.count()).toBe(0n);
    });
  });

  it("refuses an opted-in database containing a real vehicle", () => {
    const { h, tx, auth } = harness();
    tx(ctx => ctx.db.vehicle.insert({ id: 0n, name: "Real unit", driverName: "Driver", kind: "van", seats: 4, wheelchairSpaces: 0, stretcherSpaces: 0, crew: 1, lift: false, lat: 32.98, lng: -96.75, simulated: false }));
    expect(() => h.withReducerTx(auth, ctx => moduleExports.seedTornadoDemo(environment(ctx, "isolated"), {}))).toThrow("only simulated");
    tx(ctx => expect(ctx.db.household.count()).toBe(0n));
  });

  it("restarts the assistance approval cycle and retains unrelated simulated records", () => {
    const { h, tx, auth } = harness();
    const otherId = tx(ctx => insertHousehold(ctx, { riderId: "other-demo", name: "Other fixture", address: "2 Elm St", lat: 32.98, lng: -96.75, phone: "+12145550198", language: "en", mobility: "walks", assistance: "none", simulated: true }).id);
    const run = (body: (ctx: Context) => void) => h.withReducerTx(auth, ctx => body(environment(ctx, "isolated")));
    run(ctx => seedAssistanceDemo(ctx, {}));
    run(ctx => advanceAssistanceDemo(ctx, { phase: "approve" }));
    run(ctx => advanceAssistanceDemo(ctx, { phase: "accept" }));
    tx(ctx => expect(ctx.db.callback.count()).toBe(1n));
    run(ctx => seedAssistanceDemo(ctx, {}));
    tx(ctx => {
      const home = ctx.db.household.riderId.find(DEMO_WHEELCHAIR)!;
      const request = ctx.db.request.householdId.find(home.id)!;
      expect([...ctx.db.assignment.requestId.filter(request.id)].map(row => row.status)).toEqual(["proposed"]);
      expect(ctx.db.callback.count()).toBe(0n);
      expect(ctx.db.offerExpiry.count()).toBe(0n);
      expect(ctx.db.plan.count()).toBe(1n);
      expect(ctx.db.household.id.find(otherId)?.riderId).toBe("other-demo");
    });
    run(ctx => advanceAssistanceDemo(ctx, { phase: "approve" }));
    run(ctx => advanceAssistanceDemo(ctx, { phase: "accept" }));
    tx(ctx => expect(ctx.db.callback.count()).toBe(1n));
  });
});
