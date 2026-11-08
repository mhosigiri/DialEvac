import { expect, it } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedHoustonVoiceStory } from "../src/houston-demo";
import { HOUSTON_DEMO } from "../../shared/demo";

function fixture() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  const tx = <T>(body: (ctx: Parameters<typeof moduleExports.seedHoustonVoiceDemo>[0]) => T) => h.withReducerTx(TestAuth.internal(), body);
  tx(ctx => seedHoustonVoiceStory(ctx, "hurricane"));
  const home = h.db.household.riderId.find(HOUSTON_DEMO.riderId)!;
  const call = [...h.db.call.iter()][0];
  tx(ctx => moduleExports.claimCall(ctx, { callId: call.id, providerId: "elevenlabs" }));
  tx(ctx => moduleExports.recordCallAssessment(ctx, { callId: call.id, providerId: "conv-live", choice: "3", people: 2, oxygen: false }));
  const request = h.db.request.householdId.find(home.id)!;
  const vehicle = [...h.db.vehicle.iter()][0];
  tx(ctx => moduleExports.proposePlan(ctx, { solver: "test", offers: [{ requestId: request.id, vehicleId: vehicle.id, shelterId: undefined, etaMinutes: 5, stopOrder: 1 }], replace: [], revoke: [] }));
  const assignment = [...h.db.assignment.iter()][0];
  return { h, tx, home, call, request, vehicle, assignment };
}

it("queues/reuses exactly one truthful resident update only after an accepted assignment", () => {
  const { h, tx, request, assignment } = fixture();
  expect(() => tx(ctx => moduleExports.notifyResident(ctx, { requestId: request.id }))).toThrow(/accepted/);
  expect(h.db.message.count()).toBe(0n);
  tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: assignment.id }));
  expect(() => tx(ctx => moduleExports.notifyResident(ctx, { requestId: request.id }))).toThrow(/accepted/);
  tx(ctx => moduleExports.acceptOffer(ctx, { assignmentId: assignment.id }));
  const count = h.db.message.count();
  tx(ctx => moduleExports.notifyResident(ctx, { requestId: request.id }));
  tx(ctx => moduleExports.notifyResident(ctx, { requestId: request.id }));
  expect(h.db.message.count()).toBe(count);
  expect(h.db.residentNotice.count()).toBe(1n);
  expect([...h.db.message.iter()][0]).toMatchObject({ state: "queued", requestStatus: "driver_accepted" });
  tx(ctx => moduleExports.closeRequest(ctx, { requestId: request.id }));
  expect(() => tx(ctx => moduleExports.notifyResident(ctx, { requestId: request.id }))).toThrow(/accepted/);
});

it("stores masked handoff status once and does not regress a confirmed or failed transfer on replay", () => {
  const { h, tx, call } = fixture();
  const update = { callId: call.id, status: "requested", targetLabel: "Demo dispatcher ending 3841", failureReason: undefined, detail: undefined };
  tx(ctx => moduleExports.reportCallHandoff(ctx, update));
  tx(ctx => moduleExports.reportCallHandoff(ctx, update));
  expect(h.db.callHandoff.count()).toBe(1n);
  tx(ctx => moduleExports.reportCallHandoff(ctx, { ...update, status: "ringing" }));
  tx(ctx => moduleExports.reportCallHandoff(ctx, { ...update, status: "connected" }));
  tx(ctx => moduleExports.reportCallHandoff(ctx, update));
  expect(h.db.callHandoff.callId.find(call.id)?.status).toBe("connected");
  expect(() => tx(ctx => moduleExports.reportCallHandoff(ctx, { ...update, targetLabel: "+17135550100" }))).toThrow(/phone/);
});

it("retains a provider failure observed after call end without exposing phone details", () => {
  const { h, tx, call } = fixture();
  tx(ctx => moduleExports.callEnded(ctx, { callId: call.id, outcome: "answered" }));
  tx(ctx => moduleExports.reportCallHandoff(ctx, { callId: call.id, status: "failed", targetLabel: "Demo dispatcher ending 3841", failureReason: "Provider rejected transfer", detail: undefined }));
  expect(h.db.callHandoff.callId.find(call.id)).toMatchObject({ status: "failed", failureReason: "Provider rejected transfer" });
});
