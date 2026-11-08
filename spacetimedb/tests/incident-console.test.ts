import { expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as m from "../src/index";
import { spacetimedb } from "../src/schema";
import { runLadderStep } from "../src/reach";

const row = { riderId: "incident-csv-1", name: "Demo rider", address: "502 Montrose, Houston TX", lat: 29.76123664, lng: -95.39271099, phone: "+18325550100", language: "en", mobility: "wheelchair", assistance: "one_person", people: 2, oxygen: false, needProbability: undefined };
const ringsJson = JSON.stringify([[[-95.40, 29.75], [-95.38, 29.75], [-95.38, 29.78], [-95.40, 29.78], [-95.40, 29.75]]]);
function fixture(mode = "isolated") {
  const h = createModuleTestHarness(spacetimedb, m);
  const tx = <T>(body: (ctx: Parameters<typeof m.importRiders>[0]) => T) => h.withReducerTx(TestAuth.internal(), ctx => body(new Proxy(ctx, {
    get: (target, key) => key === "env" ? { DEMO_MODE: mode } : Reflect.get(target, key, target),
  })));
  return { h, tx };
}
it("imports a demo roster, saves a visible boundary, then starts outreach only when the warning is issued", () => {
  const { h, tx } = fixture();
  tx(ctx => m.importRiders(ctx, { riders: [row, { ...row, riderId: "outside", lat: 30.1 }] }));
  expect(h.db.message.count()).toBe(0n);
  tx(ctx => m.setZone(ctx, { ringsJson }));
  expect(h.db.household.riderId.find(row.riderId)).toMatchObject({ inZone: true, simulated: true });
  expect(h.db.household.riderId.find("outside")?.inZone).toBe(false);
  expect(h.db.zone.externalId.find("operator-zone")).toMatchObject({ source: "manual", active: true, rings: ringsJson });
  expect(h.db.coverage.id.find(0)?.inZone).toBe(1);
  expect(h.db.message.count()).toBe(0n);
  expect(h.db.reachStep.count()).toBe(0n);
  tx(ctx => m.issueWarning(ctx, { hazard: "flood" }));
  expect(h.db.reachStep.count()).toBe(1n);
  const home = h.db.household.riderId.find(row.riderId)!;
  tx(ctx => { runLadderStep(ctx, home.id, 0); runLadderStep(ctx, home.id, 1); });
  expect(h.db.message.count()).toBe(1n);
  expect(h.db.call.count()).toBe(1n);
  expect(h.db.control.id.find(0)?.warningAt).toBeDefined();
  tx(ctx => m.importRiders(ctx, { riders: [{ ...row, riderId: "late-import" }] }));
  expect(h.db.household.riderId.find("late-import")?.inZone).toBe(true);
  const late = h.db.household.riderId.find("late-import")!;
  tx(ctx => runLadderStep(ctx, late.id, 0));
  expect(h.db.message.count()).toBe(2n);
});
it("rejects malformed imports atomically and prevents real contacts entering the isolated demo", () => {
  const { h, tx } = fixture();
  for (const bad of [{ ...row, lat: 100 }, { ...row, people: 0 }, { ...row, mobility: "flying" }, { ...row, phone: "+12142000100" }]) {
    expect(() => tx(ctx => m.importRiders(ctx, { riders: [row, { ...bad, riderId: "bad" }] }))).toThrow();
    expect(h.db.household.count()).toBe(0n);
  }
  const operational = fixture("");
  operational.tx(ctx => m.importRiders(ctx, { riders: [{ ...row, phone: "+12142000100" }] }));
  expect([...operational.h.db.household.iter()][0].simulated).toBe(false);
});
it("validates map edits before writing and replans when a closure is saved or reopened", () => {
  const { h, tx } = fixture();
  expect(() => tx(ctx => m.setZone(ctx, { ringsJson: JSON.stringify([[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]) }))).toThrow(/cross/);
  expect(h.db.zone.count()).toBe(0n);
  const closure = { externalId: "operator-road-test", source: "manual", street: "Montrose at Allen Parkway", lat: row.lat, lng: row.lng };
  expect(() => tx(ctx => m.closeRoad(ctx, { ...closure, lat: NaN }))).toThrow(/coordinates/);
  tx(ctx => m.closeRoad(ctx, closure));
  expect(h.db.roadClosure.externalId.find(closure.externalId)?.active).toBe(true);
  const version = h.db.dispatchState.id.find(0)!.roadVersion;
  tx(ctx => m.reopenRoad(ctx, { externalId: closure.externalId }));
  expect(h.db.roadClosure.externalId.find(closure.externalId)?.active).toBe(false);
  expect(h.db.dispatchState.id.find(0)!.roadVersion).toBeGreaterThan(version);
});
