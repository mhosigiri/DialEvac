import { expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as m from "../src/index";
import { spacetimedb } from "../src/schema";
import { HOUSTON_HISTORY, historicalRiderId } from "../../shared/houston-history";
import { insertHousehold } from "../src/households";

it("seeds unique historical pickup locations with three simulated requests, no contact jobs, and preserves progress on retry", () => {
  const h = createModuleTestHarness(spacetimedb, m);
  const tx = <T>(body: (ctx: Parameters<typeof m.seedHistoricalHoustonDemo>[0]) => T) => h.withReducerTx(TestAuth.internal(), ctx => body(new Proxy(ctx, {
    get: (target, key) => key === "env" ? { DEMO_MODE: "isolated" } : Reflect.get(target, key, target),
  })));
  tx(ctx => m.seedHistoricalHoustonDemo(ctx));
  expect(h.db.household.count()).toBe(150n);
  expect(new Set(HOUSTON_HISTORY.map(r => r.address)).size).toBe(150);
  expect(new Set(HOUSTON_HISTORY.map(r => `${r.lat},${r.lng}`)).size).toBe(150);
  expect(h.db.request.count()).toBe(3n);
  expect(h.db.call.count()).toBe(0n);
  expect(h.db.message.count()).toBe(0n);
  expect(h.db.vehicle.count()).toBe(3n);
  expect(h.db.coverage.id.find(0)).toMatchObject({ inZone: 150, doorCheck: 147, overlooked: 0 });
  for (const row of HOUSTON_HISTORY) expect(h.db.household.riderId.find(historicalRiderId(row.caseNumber))).toMatchObject({ address: row.address, lat: row.lat, lng: row.lng, simulated: true });
  const home = h.db.household.riderId.find(historicalRiderId(HOUSTON_HISTORY[0].caseNumber))!;
  const req = h.db.request.householdId.find(home.id)!;
  tx(ctx => m.matchClosestDispatcher(ctx, { requestId: req.id }));
  const assignment = [...h.db.assignment.iter()][0];
  const route = h.db.dispatchRoute.assignmentId.find(assignment.id)!;
  expect(route).toMatchObject({ destinationLat: home.lat, destinationLng: home.lng, state: "pending" });
  tx(ctx => m.approveOffer(ctx, { assignmentId: assignment.id }));
  tx(ctx => m.acceptOffer(ctx, { assignmentId: assignment.id }));
  tx(ctx => m.seedHistoricalHoustonDemo(ctx));
  expect(h.db.household.count()).toBe(150n);
  expect(h.db.assignment.id.find(assignment.id)?.status).toBe("accepted");
  expect(h.db.dispatchRoute.assignmentId.find(assignment.id)).toEqual(route);
});

it("rejects importing historical fixtures into a database without demo opt-in", () => {
  const h = createModuleTestHarness(spacetimedb, m);
  expect(() => h.withReducerTx(TestAuth.internal(), ctx => m.seedHistoricalHoustonDemo(new Proxy(ctx, {
    get: (target, key) => key === "env" ? {} : Reflect.get(target, key, target),
  })))).toThrow(/disabled/);
  expect(h.db.household.count()).toBe(0n);
});

it("repairs the known legacy driver fixture but rolls back when any unrelated real household remains", () => {
  const h = createModuleTestHarness(spacetimedb, m);
  const tx = <T>(body: (ctx: Parameters<typeof m.seedHistoricalHoustonDemo>[0]) => T) => h.withReducerTx(TestAuth.internal(), ctx => body(new Proxy(ctx, {
    get: (target, key) => key === "env" ? { DEMO_MODE: "isolated" } : Reflect.get(target, key, target),
  })));
  const base = { ...HOUSTON_HISTORY[0], name: "Marcus Vance", phone: "+17135550999", language: "en", mobility: "wheelchair", assistance: "one_person", simulated: false };
  const legacy = tx(ctx => insertHousehold(ctx, { ...base, riderId: "driver-demo-montrose-1" }));
  const real = tx(ctx => insertHousehold(ctx, { ...base, riderId: "unrelated-real-household" }));
  expect(() => tx(ctx => m.seedHistoricalHoustonDemo(ctx))).toThrow(/only simulated/);
  expect(h.db.household.id.find(legacy.id)?.simulated).toBe(false);
  tx(ctx => ctx.db.household.id.delete(real.id));
  tx(ctx => m.seedHistoricalHoustonDemo(ctx));
  expect(h.db.household.id.find(legacy.id)).toMatchObject({ simulated: true, phone: "+13465550190", name: "Marcus Vance" });
});
