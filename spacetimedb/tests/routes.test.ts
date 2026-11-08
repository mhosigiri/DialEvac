import { expect, it, vi } from "vitest";
import { TimeDuration } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedHoustonVoiceStory } from "../src/houston-demo";
import { commitRoadRoute, parseRoadRoute } from "../src/routes";

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
  const body = { code: "Ok", routes: [{ distance: 1400, duration: 210, geometry: { type: "LineString", coordinates: [[vehicle.lng, vehicle.lat], [home.lng, home.lat]] } }] };
  return { h, tx, home, vehicle, request, a, snapshot, body };
}

it("translates OSRM longitude/latitude road geometry and keeps distance and duration in their documented units", () => {
  const { h, tx, snapshot, body, vehicle, home, a } = fixture();
  tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: a.id }));
  expect(h.db.routeJob.count()).toBe(1n);
  tx(ctx => commitRoadRoute(ctx, snapshot, parseRoadRoute(body)));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ state: "ready", source: "osrm", distanceMeters: 1400, durationSeconds: 210,
    points: [{ lat: vehicle.lat, lng: vehicle.lng }, { lat: home.lat, lng: home.lng }] });
});

it("automatically queues the responder-to-resident route when a dispatcher creates an assignment", () => {
  const { h, tx, a, home, vehicle } = fixture();
  // The fixture's explicit request is an idempotent reuse of the route already queued by proposePlan.
  expect(h.db.routeJob.count()).toBe(1n);
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ originLat: vehicle.lat, originLng: vehicle.lng, destinationLat: home.lat, destinationLng: home.lng, state: "pending" });
  tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: a.id }));
  expect(h.db.routeJob.count()).toBe(1n);
});

it("stores guidance only for the current accepted geometry and rejects stale or unrelated directions", () => {
  const { h, tx, a, snapshot, body, vehicle, home } = fixture();
  tx(ctx => commitRoadRoute(ctx, snapshot, parseRoadRoute(body)));
  const args = { assignmentId: a.id, revision: snapshot.revision, stepsJson: JSON.stringify([{ instruction: "Depart", road: "Test road", distanceMeters: 1400, durationSeconds: 210, lat: vehicle.lat, lng: vehicle.lng }]), summary: "Take the verified road route.", model: "gemini-test", error: undefined };
  tx(ctx => moduleExports.recordRouteGuidance(ctx, { ...args, revision: args.revision + 1n }));
  expect(h.db.routeGuidance.count()).toBe(0n);
  expect(() => tx(ctx => moduleExports.recordRouteGuidance(ctx, { ...args, stepsJson: JSON.stringify([{ instruction: "Wrong road", road: "Other", distanceMeters: 1, durationSeconds: 1, lat: 0, lng: 0 }]) }))).toThrow(/accepted road/);
  tx(ctx => moduleExports.recordRouteGuidance(ctx, args));
  expect(h.db.routeGuidance.assignmentId.find(a.id)).toMatchObject({ state: "ready", summary: args.summary, model: args.model });
  tx(ctx => ctx.db.household.id.update({ ...home, lat: home.lat + 0.01 }));
  tx(ctx => moduleExports.recordRouteGuidance(ctx, { ...args, summary: "Late result" }));
  expect(h.db.routeGuidance.assignmentId.find(a.id)?.summary).toBe(args.summary);
});

it("records provider failure with no invented straight-line route", () => {
  const { h, tx, a, snapshot } = fixture();
  tx(ctx => commitRoadRoute(ctx, snapshot, undefined, "Routing provider unavailable"));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ state: "failed", points: [], distanceMeters: undefined, durationSeconds: undefined });
  expect(() => parseRoadRoute({ code: "NoRoute" })).toThrow(/Invalid/);
  expect(() => parseRoadRoute({ code: "Ok", routes: [{ distance: 1, duration: 1, geometry: { type: "LineString", coordinates: [[-95, 29], [NaN, 29]] } }] })).toThrow(/coordinates/);
});

it("allows a stale pending route to be requested again and rejects its late result and timeout", () => {
  const { h, tx, a, snapshot, body } = fixture();
  const oldTimeout = [...h.db.routeTimeout.iter()][0];
  h.clock.advance(TimeDuration.fromMillis(29_999));
  tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: a.id }));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)?.revision).toBe(snapshot.revision);
  h.clock.advance(TimeDuration.fromMillis(1));
  tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: a.id }));
  const fresh = h.db.dispatchRoute.assignmentId.find(a.id)!;
  expect(fresh.revision).toBe(snapshot.revision + 1n);
  tx(ctx => commitRoadRoute(ctx, snapshot, parseRoadRoute(body)));
  tx(ctx => moduleExports.expireDispatchRoute(ctx, { arg: oldTimeout }));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toEqual(fresh);
  tx(ctx => commitRoadRoute(ctx, fresh, parseRoadRoute(body)));
  const freshTimeout = [...h.db.routeTimeout.iter()].find(job => job.revision === fresh.revision)!;
  tx(ctx => moduleExports.expireDispatchRoute(ctx, { arg: freshTimeout }));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)?.state).toBe("ready");
});

it("expires an abandoned route so the portal can retry and cannot be revived by its late procedure", () => {
  const { h, tx, a, snapshot, body } = fixture();
  const timeout = [...h.db.routeTimeout.iter()][0];
  h.clock.advance(TimeDuration.fromMillis(30_000));
  tx(ctx => moduleExports.expireDispatchRoute(ctx, { arg: timeout }));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ state: "failed", points: [], failureReason: expect.stringContaining("timed out") });
  tx(ctx => commitRoadRoute(ctx, snapshot, parseRoadRoute(body)));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)?.state).toBe("failed");
  tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: a.id }));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ state: "pending", revision: snapshot.revision + 1n });
});

it("rejects stale responses after closure and when the responder location changes", () => {
  const { h, tx, a, snapshot, body, request, vehicle } = fixture();
  tx(ctx => ctx.db.vehicle.id.update({ ...vehicle, lat: vehicle.lat + 0.01 }));
  tx(ctx => commitRoadRoute(ctx, snapshot, parseRoadRoute(body)));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)?.state).toBe("failed");
  tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: a.id }));
  const fresh = h.db.dispatchRoute.assignmentId.find(a.id)!;
  tx(ctx => moduleExports.closeRequest(ctx, { requestId: request.id }));
  tx(ctx => commitRoadRoute(ctx, fresh, parseRoadRoute(body)));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ state: "failed", points: [], failureReason: "Request closed" });
  expect(() => tx(ctx => moduleExports.requestDispatchRoute(ctx, { assignmentId: a.id }))).toThrow(/live assignment/);
});

it("rejects geometry that crosses a recorded road closure", () => {
  const { h, tx, a, snapshot, body, vehicle, home } = fixture();
  tx(ctx => ctx.db.roadClosure.insert({ id: 0n, externalId: "route-test", source: "simulated", street: "Demo closure", active: true,
    lat: (vehicle.lat + home.lat) / 2, lng: (vehicle.lng + home.lng) / 2, at: ctx.timestamp }));
  tx(ctx => commitRoadRoute(ctx, snapshot, parseRoadRoute(body)));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ state: "failed", points: [], failureReason: "Road route intersects a reported closure" });
});

it("runs the internal OSRM procedure and commits only the real returned road geometry", () => {
  const { h, body, a } = fixture();
  const job = [...h.db.routeJob.iter()][0];
  let url = "";
  const base = h.procedureContextBuilder(TestAuth.internal()).http((_h, request) => {
    url = request.uri;
    return { code: 200, version: { tag: "Http11" }, headers: { entries: [] }, body: JSON.stringify(body) };
  }).build();
  const ctx = new Proxy(base, { get: (target, key) => {
    if (key === "env") return { ROUTER_URL: "https://router.example.test" };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  moduleExports.calculateDispatchRoute(ctx, { arg: job });
  expect(url).toContain("https://router.example.test/route/v1/driving/");
  expect(url).toContain("geometries=geojson");
  expect(h.db.dispatchRoute.assignmentId.find(a.id)?.state).toBe("ready");
});

it("lets the service bridge recover a provider failure while preserving stale-result and closure checks", () => {
  const { h, tx, snapshot, body, a, request } = fixture();
  tx(ctx => commitRoadRoute(ctx, snapshot, undefined, "Routing provider unavailable"));
  const result = parseRoadRoute(body);
  const update = { assignmentId: a.id, revision: snapshot.revision, ...result, failureReason: undefined };
  tx(ctx => moduleExports.recordDispatchRoute(ctx, { ...update, revision: snapshot.revision + 1n }));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)?.state).toBe("failed");
  tx(ctx => moduleExports.recordDispatchRoute(ctx, update));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)?.state).toBe("ready");
  tx(ctx => moduleExports.closeRequest(ctx, { requestId: request.id }));
  tx(ctx => moduleExports.recordDispatchRoute(ctx, update));
  expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ state: "failed", points: [], failureReason: "Request closed" });
});

it("logs the native HTTP status for diagnosis while keeping provider details out of the public failure row", () => {
  const { h, a } = fixture(), job = [...h.db.routeJob.iter()][0];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const base = h.procedureContextBuilder(TestAuth.internal()).http(() => ({ code: 403, version: { tag: "Http11" }, headers: { entries: [] }, body: "Provider detail" })).build();
    const ctx = new Proxy(base, { get: (target, key) => {
      if (key === "env") return {};
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    moduleExports.calculateDispatchRoute(ctx, { arg: job });
    expect(log).toHaveBeenCalledWith("[routing] native OSRM fetch failed", "Error: Routing provider returned HTTP 403");
    expect(h.db.dispatchRoute.assignmentId.find(a.id)).toMatchObject({ state: "failed", points: [], failureReason: "Routing provider unavailable or no valid road route returned" });
  } finally { log.mockRestore(); }
});
