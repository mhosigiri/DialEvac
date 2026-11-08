import { expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedHoustonVoiceStory } from "../src/houston-demo";
import { HOUSTON_DEMO } from "../../shared/demo";

it.each(["hurricane", "flood", "wildfire"])("seeds one Houston %s phone interaction with no real contacts or repeated surveys", hazard => {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  const tx = <T>(body: (ctx: Parameters<typeof moduleExports.seedHoustonVoiceDemo>[0]) => T) => h.withReducerTx(TestAuth.internal(), body);
  tx(ctx => seedHoustonVoiceStory(ctx, hazard));
  tx(ctx => seedHoustonVoiceStory(ctx, hazard));
  const home = h.db.household.riderId.find(HOUSTON_DEMO.riderId)!;
  expect(home).toMatchObject({ simulated: true, inZone: true, phone: "+17135550100", canLeave: undefined });
  expect([...h.db.call.householdId.filter(home.id)]).toHaveLength(1);
  expect([...h.db.call.iter()][0].phase).toBe("queued");
  expect(h.db.request.count()).toBe(0n);
  expect(h.db.zone.count()).toBe(1n);
  const zone = [...h.db.zone.iter()][0];
  expect(JSON.parse(zone.geometryJson!)).toEqual({ type: "Polygon", coordinates: JSON.parse(zone.rings) });
  expect(h.db.vehicle.count()).toBe(1n);
  expect(h.db.control.id.find(0)).toMatchObject({ warningAt: undefined, simulateVoice: false, simulateDrivers: false, autoApprove: false });
  const call = [...h.db.call.iter()][0];
  tx(ctx => moduleExports.claimCall(ctx, { callId: call.id, providerId: "elevenlabs" }));
  tx(ctx => seedHoustonVoiceStory(ctx, hazard));
  expect(h.db.call.id.find(call.id)?.phase).toBe("ringing");
  tx(ctx => moduleExports.callEnded(ctx, { callId: call.id, outcome: "answered" }));
  tx(ctx => seedHoustonVoiceStory(ctx, hazard));
  expect(h.db.call.count()).toBe(1n);
  expect(h.db.call.id.find(call.id)?.phase).toBe("ended");
});

it("backfills a previously seeded polygon without resetting the active survey or answers", () => {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  const tx = <T>(body: (ctx: Parameters<typeof moduleExports.seedHoustonVoiceDemo>[0]) => T) => h.withReducerTx(TestAuth.internal(), body);
  tx(ctx => seedHoustonVoiceStory(ctx, "hurricane"));
  const zone = [...h.db.zone.iter()][0], call = [...h.db.call.iter()][0];
  tx(ctx => ctx.db.zone.id.update({ ...zone, geometryJson: undefined }));
  tx(ctx => moduleExports.claimCall(ctx, { callId: call.id, providerId: "elevenlabs" }));
  tx(ctx => moduleExports.recordCallAssessment(ctx, { callId: call.id, providerId: "mock-live", choice: "3", people: 2, oxygen: true }));
  const home = [...h.db.household.iter()][0], request = [...h.db.request.iter()][0];
  tx(ctx => seedHoustonVoiceStory(ctx, "flood"));
  expect(h.db.zone.id.find(zone.id)).toEqual(zone);
  expect(h.db.household.id.find(home.id)).toEqual(home);
  expect(h.db.request.id.find(request.id)).toEqual(request);
  expect(h.db.call.id.find(call.id)?.phase).toBe("live");
  expect(h.db.call.count()).toBe(1n);
});
