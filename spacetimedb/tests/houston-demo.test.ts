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
