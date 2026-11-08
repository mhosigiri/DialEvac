import { expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as m from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedTornadoIncident } from "../src/loop";
import { insertHousehold } from "../src/households";

function fixture() {
  const h = createModuleTestHarness(spacetimedb, m);
  const tx = <T>(f: (ctx: Parameters<typeof m.prepareHoustonDemo>[0]) => T) => h.withReducerTx(TestAuth.internal(), ctx => f(new Proxy(ctx, { get: (target, key) => key === "env" ? { DEMO_MODE: "isolated" } : Reflect.get(target, key, target) })));
  return { h, tx };
}
it("retires Richardson without deleting records, prepares all three Houston hazards and accounts for every home", () => {
  const { h, tx } = fixture();
  tx(ctx => seedTornadoIncident(ctx, false));
  const before = h.db.household.count();
  tx(ctx => m.prepareHoustonDemo(ctx)); tx(ctx => m.prepareHoustonDemo(ctx));
  expect(h.db.household.count()).toBe(before + 4n);
  expect([...h.db.household.inZone.filter(true)]).toHaveLength(4);
  expect([...h.db.zone.iter()].filter(z => z.active).map(z => z.event).sort()).toEqual(["flood", "hurricane", "wildfire"]);
  expect([...h.db.zone.iter()].filter(z => z.active).every(z => JSON.parse(z.geometryJson!).type === "Polygon")).toBe(true);
  expect(h.db.coverage.id.find(0)).toMatchObject({ inZone: 4, reaching: 1, doorCheck: 3, overlooked: 0 });
});
it("keeps oxygen, wheelchair and stretcher needs in-zone across preparation and simulated assessment without changing the reserved live profile", () => {
  const { h, tx } = fixture();
  tx(ctx => m.prepareHoustonDemo(ctx));
  const live = h.db.household.riderId.find("demo-houston-anish")!;
  const liveCalls = [...h.db.call.householdId.filter(live.id)];
  for (const [hazard, mobility, oxygen] of [["hurricane", "walks", true], ["flood", "wheelchair", false], ["wildfire", "bedbound", false]] as const) {
    const home = h.db.household.riderId.find(`demo-houston-catalogue-${hazard}`)!;
    expect(home).toMatchObject({ inZone: true, mobility, oxygen });
    tx(ctx => m.simulateCatastrophe(ctx, { hazard, runId: `badges-${hazard}` }));
    tx(ctx => m.simulateAssessment(ctx, { householdId: home.id }));
    expect(h.db.request.householdId.find(home.id)).toMatchObject({ mobility, oxygen });
    const callId = h.db.catastropheCase.householdId.find(home.id)!.callId;
    expect([...h.db.transcriptLine.iter()].find(t => t.callId === callId && t.speaker === "resident")?.text).toContain(oxygen ? "Supplemental oxygen required" : "No supplemental oxygen");
  }
  tx(ctx => m.prepareHoustonDemo(ctx));
  expect(h.db.household.id.find(live.id)).toEqual(live);
  expect([...h.db.call.householdId.filter(live.id)]).toEqual(liveCalls);
});
it("upgrades existing synthetic catalogue needs without resetting calls or historical assessment snapshots", () => {
  const { h, tx } = fixture();
  tx(ctx => m.simulateCatastrophe(ctx, { hazard: "wildfire", runId: "existing-catalogue" }));
  const home = h.db.household.riderId.find("demo-houston-catalogue-wildfire")!;
  tx(ctx => m.simulateAssessment(ctx, { householdId: home.id }));
  const calls = [...h.db.call.iter()], member = h.db.catastropheCase.householdId.find(home.id)!;
  tx(ctx => ctx.db.household.id.update({ ...ctx.db.household.id.find(home.id)!, mobility: "walks", assistance: "none", inZone: false }));
  tx(ctx => m.prepareHoustonDemo(ctx));
  expect(h.db.household.id.find(home.id)).toMatchObject({ inZone: true, mobility: "bedbound", assistance: "two_person_lift", oxygen: false });
  expect(h.db.request.householdId.find(home.id)).toMatchObject({ status: "received", mobility: "bedbound", assistance: "two_person_lift" });
  expect([...h.db.call.iter()]).toEqual(calls);
  expect(h.db.catastropheCase.householdId.find(home.id)?.duringSnapshotJson).toBe(member.duringSnapshotJson);
});
it.each(["hurricane", "flood", "wildfire"])("rehearses %s from polygon and queued simulated survey through accepted assignment, closure and compared follow-up", hazard => {
  const { h, tx } = fixture();
  tx(ctx => m.simulateCatastrophe(ctx, { hazard, runId: "test-run" }));
  const home = h.db.household.riderId.find("demo-houston-run-test-run")!;
  const calls = h.db.call.count();
  tx(ctx => m.simulateCatastrophe(ctx, { hazard, runId: "test-run" })); expect(h.db.call.count()).toBe(calls);
  expect(h.db.catastropheCase.householdId.find(home.id)?.hazard).toBe(hazard);
  expect([...h.db.call.householdId.filter(home.id)][0].phase).toBe("queued");
  tx(ctx => m.simulateAssessment(ctx, { householdId: home.id })); tx(ctx => m.simulateAssessment(ctx, { householdId: home.id }));
  expect([...h.db.transcriptLine.iter()].filter(t => t.callId === h.db.catastropheCase.householdId.find(home.id)?.callId)).toHaveLength(2);
  const request = h.db.request.householdId.find(home.id)!;
  expect(request.status).toBe("received");
  tx(ctx => m.matchClosestDispatcher(ctx, { requestId: request.id })); tx(ctx => m.matchClosestDispatcher(ctx, { requestId: request.id }));
  const a = [...h.db.assignment.requestId.filter(request.id)][0];
  expect([...h.db.assignment.requestId.filter(request.id)]).toHaveLength(1);
  expect(h.db.vehicle.id.find(a.vehicleId)?.name).toBe(hazard === "wildfire" ? "Houston medical unit" : "Houston rescue unit");
  tx(ctx => m.approveOffer(ctx, { assignmentId: a.id })); tx(ctx => m.acceptOffer(ctx, { assignmentId: a.id }));
  tx(ctx => m.notifyResident(ctx, { requestId: request.id })); tx(ctx => m.simulateResidentDelivery(ctx, { requestId: request.id }));
  expect([...h.db.message.householdId.filter(home.id)].every(msg => msg.state === "sent" && msg.providerId?.startsWith("simulated:"))).toBe(true);
  expect(() => tx(ctx => m.simulateFollowUp(ctx, { householdId: home.id }))).toThrow(/closed/);
  tx(ctx => m.closeRequest(ctx, { requestId: request.id }));
  expect(h.db.assignment.id.find(a.id)?.status).toBe("completed");
  expect(h.db.coverage.id.find(0)?.helped).toBe(1);
  const during = h.db.household.id.find(home.id);
  tx(ctx => m.simulateFollowUp(ctx, { householdId: home.id })); tx(ctx => m.simulateFollowUp(ctx, { householdId: home.id }));
  expect(h.db.followUp.count()).toBe(1n);
  const follow = h.db.followUp.householdId.find(home.id)!;
  expect(follow).toMatchObject({ simulated: true, state: "completed", insuranceSelf: true, insuranceVehicle: false, insuranceProperty: undefined });
  expect(JSON.parse(follow.changesJson)).toContainEqual({ field: "canLeave", before: false, after: true });
  expect(h.db.household.id.find(home.id)).toEqual(during);
});
it("refuses missing demo opt-in, non-synthetic records and the reserved live-call profile", () => {
  const { h, tx } = fixture();
  expect(() => h.withReducerTx(TestAuth.internal(), ctx => m.prepareHoustonDemo(new Proxy(ctx, { get: (target, key) => key === "env" ? {} : Reflect.get(target, key, target) })))).toThrow(/disabled/);
  tx(ctx => m.prepareHoustonDemo(ctx));
  const live = h.db.household.riderId.find("demo-houston-anish")!;
  expect(() => tx(ctx => m.simulateAssessment(ctx, { householdId: live.id }))).toThrow(/simulated/);
  tx(ctx => ctx.db.household.id.update({ ...live, simulated: false }));
  expect(() => tx(ctx => m.simulateCatastrophe(ctx, { hazard: "flood", runId: "blocked" }))).toThrow(/only simulated/);
});

it("spatially scans unlinked residents, excludes outsiders and preserves the queued live demo call", () => {
  const { h, tx } = fixture();
  tx(ctx => m.prepareHoustonDemo(ctx));
  const live = h.db.household.riderId.find("demo-houston-anish")!;
  const liveCall = [...h.db.call.householdId.filter(live.id)][0];
  const row = { riderId: "unlinked", name: "Synthetic additional resident", address: "Synthetic Houston address", lat: 29.745, lng: -95.36,
    phone: "+17135550198", language: "en", mobility: "walks", assistance: "none", simulated: true };
  const inside = tx(ctx => insertHousehold(ctx, row));
  const outside = tx(ctx => insertHousehold(ctx, { ...row, riderId: "outside", lat: 30.2 }));
  tx(ctx => m.simulateCatastrophe(ctx, { hazard: "flood", runId: "spatial" }));
  expect(h.db.catastropheCase.householdId.find(inside.id)?.callId).toBeDefined();
  expect([...h.db.call.householdId.filter(outside.id)]).toHaveLength(0);
  expect(h.db.call.id.find(liveCall.id)).toEqual(liveCall);
});
