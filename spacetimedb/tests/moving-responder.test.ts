import { expect, it } from "vitest";
import { TimeDuration } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedHoustonVoiceStory } from "../src/houston-demo";
import { commitRoadRoute, parseRoadRoute } from "../src/routes";
import { heartbeat, startNight } from "../src/loop";
import { metersBetween } from "../src/domain/geo";
import { routeMatchesLocations } from "../../shared/route-guidance";

// A dogleg route, so driving it and driving straight at the destination are clearly different.
function fixture() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  const tx = <T>(body: (ctx: Parameters<typeof moduleExports.seedHoustonVoiceDemo>[0]) => T) => h.withReducerTx(TestAuth.internal(), body);
  tx(ctx => seedHoustonVoiceStory(ctx, "flood"));
  const home = [...h.db.household.iter()][0], call = [...h.db.call.iter()][0], vehicle = [...h.db.vehicle.iter()][0];
  tx(ctx => moduleExports.claimCall(ctx, { callId: call.id, providerId: "elevenlabs" }));
  tx(ctx => moduleExports.recordCallAssessment(ctx, { callId: call.id, providerId: "conv-route", choice: "2", people: 1, oxygen: false }));
  const request = h.db.request.householdId.find(home.id)!;
  tx(ctx => moduleExports.proposePlan(ctx, { solver: "test", offers: [{ requestId: request.id, vehicleId: vehicle.id, shelterId: undefined, etaMinutes: 5, stopOrder: 1 }], replace: [], revoke: [] }));
  const a = [...h.db.assignment.iter()][0];
  tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: a.id }));
  const snapshot = h.db.dispatchRoute.assignmentId.find(a.id)!;
  const corner = { lat: vehicle.lat + 0.02, lng: vehicle.lng };
  const body = { code: "Ok", source: "osmnx", routes: [{ distance: 6000, duration: 600, geometry: { type: "LineString", coordinates: [[vehicle.lng, vehicle.lat], [corner.lng, corner.lat], [home.lng, home.lat]] } }] };
  const moveVehicle = (to: { lat: number; lng: number }) => tx(ctx => ctx.db.vehicle.id.update({ ...vehicle, ...to }));
  const halfwayToCorner = { lat: vehicle.lat + 0.01, lng: vehicle.lng };
  const farOffRoute = { lat: vehicle.lat - 0.05, lng: vehicle.lng - 0.05 };
  return { h, tx, home, vehicle, a, snapshot, body, moveVehicle, halfwayToCorner, farOffRoute };
}

const guidance = (f: ReturnType<typeof fixture>) => ({
  assignmentId: f.a.id, revision: f.snapshot.revision, model: "gemini-test", summary: "Follow the road route.", error: undefined,
  stepsJson: JSON.stringify([{ instruction: "Depart", road: "Test road", distanceMeters: 1, durationSeconds: 1, lat: f.vehicle.lat, lng: f.vehicle.lng }]),
});

it("a responder who keeps driving while the route is calculated still gets the route", () => {
  const f = fixture();
  f.moveVehicle(f.halfwayToCorner);
  f.tx(ctx => commitRoadRoute(ctx, f.snapshot, parseRoadRoute(f.body)));
  expect(f.h.db.dispatchRoute.assignmentId.find(f.a.id)).toMatchObject({ state: "ready", failureReason: undefined });
});

it("a responder who ends up far from the new route gets a failure, not wrong directions", () => {
  const f = fixture();
  f.moveVehicle(f.farOffRoute);
  f.tx(ctx => commitRoadRoute(ctx, f.snapshot, parseRoadRoute(f.body)));
  expect(f.h.db.dispatchRoute.assignmentId.find(f.a.id)).toMatchObject({ state: "failed", points: [] });
});

it("directions are stored for a responder driving the route and refused once they leave it", () => {
  const f = fixture();
  f.tx(ctx => commitRoadRoute(ctx, f.snapshot, parseRoadRoute(f.body)));
  f.moveVehicle(f.halfwayToCorner);
  f.tx(ctx => moduleExports.recordRouteGuidance(ctx, guidance(f)));
  expect(f.h.db.routeGuidance.assignmentId.find(f.a.id)?.summary).toBe("Follow the road route.");
  f.moveVehicle(f.farOffRoute);
  f.tx(ctx => moduleExports.recordRouteGuidance(ctx, { ...guidance(f), summary: "Late result" }));
  expect(f.h.db.routeGuidance.assignmentId.find(f.a.id)?.summary).toBe("Follow the road route.");
});

it("asking again while a nearby responder's route is still calculating does not restart it", () => {
  const f = fixture();
  f.moveVehicle({ lat: f.vehicle.lat + 0.0005, lng: f.vehicle.lng });
  f.tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: f.a.id }));
  expect(f.h.db.dispatchRoute.assignmentId.find(f.a.id)?.revision).toBe(f.snapshot.revision);
  f.moveVehicle(f.farOffRoute);
  f.tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: f.a.id }));
  expect(f.h.db.dispatchRoute.assignmentId.find(f.a.id)?.revision).toBe(f.snapshot.revision + 1n);
});

it("a moved resident always invalidates the route, however close the responder is", () => {
  const f = fixture();
  f.tx(ctx => commitRoadRoute(ctx, f.snapshot, parseRoadRoute(f.body)));
  const route = f.h.db.dispatchRoute.assignmentId.find(f.a.id)!;
  expect(routeMatchesLocations(route, f.vehicle, f.home)).toBe(true);
  expect(routeMatchesLocations(route, f.vehicle, { lat: f.home.lat + 0.0001, lng: f.home.lng })).toBe(false);
});

it("a heartbeat drives the responder along the road route all the way to the pickup", () => {
  const f = fixture();
  f.tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: f.a.id }));
  f.tx(ctx => moduleExports.acceptOffer(ctx, { assignmentId: f.a.id }));
  f.tx(ctx => commitRoadRoute(ctx, f.snapshot, parseRoadRoute(f.body)));
  const route = f.h.db.dispatchRoute.assignmentId.find(f.a.id)!;

  let ticks = 0, sawCorner = false, lastEta = Infinity;
  while (f.h.db.assignment.id.find(f.a.id)?.status === "accepted" && ticks < 500) {
    ticks++;
    f.h.clock.advance(TimeDuration.fromMillis(5_000));
    f.tx(ctx => heartbeat(ctx));
    const vehicle = f.h.db.vehicle.id.find(f.vehicle.id)!;
    expect(routeMatchesLocations(route, vehicle, f.home)).toBe(true);
    if (metersBetween(vehicle, { lat: f.vehicle.lat + 0.02, lng: f.vehicle.lng }) < 100) sawCorner = true;
    const eta = f.h.db.request.id.find(route.requestId)?.etaMinutes;
    if (eta !== undefined) {
      expect(eta).toBeLessThanOrEqual(lastEta);
      lastEta = eta;
    }
  }
  expect(sawCorner).toBe(true);
  expect(f.h.db.assignment.id.find(f.a.id)?.status).toBe("completed");
});

it("a route that waited for the incident to start is driven from its beginning", () => {
  const f = fixture();
  f.tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: f.a.id }));
  f.tx(ctx => moduleExports.acceptOffer(ctx, { assignmentId: f.a.id }));
  f.tx(ctx => commitRoadRoute(ctx, f.snapshot, parseRoadRoute(f.body)));
  f.h.clock.advance(TimeDuration.fromMillis(30 * 60_000));
  f.tx(ctx => startNight(ctx, "flood"));
  f.h.clock.advance(TimeDuration.fromMillis(1_000));
  f.tx(ctx => heartbeat(ctx));
  expect(f.h.db.assignment.id.find(f.a.id)?.status).toBe("accepted");
  expect(metersBetween(f.h.db.vehicle.id.find(f.vehicle.id)!, f.vehicle)).toBeLessThan(50);
});

it("a responder with no road route still drives straight to the pickup", () => {
  const f = fixture();
  f.tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: f.a.id }));
  f.tx(ctx => moduleExports.acceptOffer(ctx, { assignmentId: f.a.id }));
  const before = metersBetween(f.vehicle, f.home);
  f.h.clock.advance(TimeDuration.fromMillis(5_000));
  f.tx(ctx => heartbeat(ctx));
  expect(metersBetween(f.h.db.vehicle.id.find(f.vehicle.id)!, f.home)).toBeLessThan(before);
});
