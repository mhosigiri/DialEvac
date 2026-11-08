import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDriverStops } from "../src/lib/driver-state";
import { followRoute } from "../src/lib/route-progress";
import { TurnByTurnNav } from "../src/components/TurnByTurnNav";
import type { Assignment, DispatchRoute, Household, Request, RouteGuidance, Vehicle } from "../src/module_bindings/types";

const start = { lat: 29.77, lng: -95.405 };
const corner = { lat: 29.77, lng: -95.3973 };
const pickup = { lat: 29.7627, lng: -95.3973 };
const metersPerLng = Math.cos((start.lat * Math.PI) / 180) * 111_320;
const beforeCorner = (meters: number) => ({ lat: corner.lat, lng: corner.lng - meters / metersPerLng });
const pastCorner = (meters: number) => ({ lat: corner.lat - meters / 110_540, lng: corner.lng });
const firstLeg = (corner.lng - start.lng) * metersPerLng;
const secondLeg = (corner.lat - pickup.lat) * 110_540;

const steps = [
  { instruction: "Depart east on First Road", road: "First Road", distanceMeters: firstLeg, durationSeconds: 67, ...start },
  { instruction: "Turn right on Second Road", road: "Second Road", distanceMeters: secondLeg, durationSeconds: 73, ...corner },
  { instruction: "Arrive at the destination", road: "", distanceMeters: 0, durationSeconds: 0, ...pickup },
];
const home = { id: 1n, name: "Demo resident", address: "1 Main", ...pickup, simulated: true } as Household;
const request = { id: 3n, householdId: 1n, status: "en_route", people: 1, mobility: "walks", assistance: "none" } as Request;
const assignment = { id: 4n, requestId: 3n, vehicleId: 2n, status: "accepted", stopOrder: 1 } as Assignment;
const stop = buildDriverStops([assignment], [request], [home], [], 2n)[0];
const route = { assignmentId: 4n, revision: 1n, state: "ready", originLat: start.lat, originLng: start.lng, destinationLat: pickup.lat, destinationLng: pickup.lng,
  points: [start, corner, pickup], distanceMeters: firstLeg + secondLeg, durationSeconds: 140 } as DispatchRoute;
const guidance = { assignmentId: 4n, revision: 1n, state: "ready", summary: "Brief", model: "gemini-test", stepsJson: JSON.stringify(steps) } as RouteGuidance;

// The instruction banner is everything before the map's own label.
const bannerAt = (position: { lat: number; lng: number }) => {
  const html = renderToStaticMarkup(<TurnByTurnNav stop={stop} vehicle={{ id: 2n, name: "Unit", ...position } as Vehicle} route={route} guidance={guidance} roadClosures={[]} onRequestRoute={() => {}} busy={false} />);
  return html.slice(0, html.indexOf("OSMnx road route")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
};

test("the first step shows while the responder drives the first road", () => {
  const banner = bannerAt(beforeCorner(300));
  assert.ok(banner.includes("Depart east on First Road"));
  assert.ok(banner.includes("Turn right on Second Road in 984 ft"), banner);
});

test("the next turn takes over shortly before the responder reaches it", () => {
  assert.ok(bannerAt(beforeCorner(200)).includes("Depart east on First Road"));
  const banner = bannerAt(beforeCorner(30));
  assert.ok(!banner.includes("Depart east on First Road"), banner);
  assert.ok(banner.includes("Turn right on Second Road"));
});

test("past the corner the responder sees the second road and how much of it is left", () => {
  const banner = bannerAt(pastCorner(200));
  assert.ok(banner.includes("Turn right on Second Road"));
  assert.ok(banner.includes(`for ${Math.round((secondLeg - 200) * 3.28084)} ft`), banner);
  assert.ok(banner.includes("Arrive at the destination in"), banner);
});

test("the last step shows on the final approach", () => {
  const banner = bannerAt(pastCorner(secondLeg - 20));
  assert.ok(banner.includes("Arrive at the destination"));
  assert.ok(!banner.includes("Then"), banner);
});

test("opening the screen mid-route starts on the step the responder is on", () => {
  const banner = bannerAt(pastCorner(100));
  assert.ok(banner.includes("Turn right on Second Road"));
  assert.ok(!banner.includes("Depart east on First Road"), banner);
});

const out = { lat: 29.77, lng: -95.40 };
const deadEnd = { lat: 29.77, lng: -95.39 };
const home2 = { lat: 29.76, lng: -95.40 };
const backtrack = [out, deadEnd, out, home2];
const backtrackSteps = [
  { instruction: "Drive to the dead end", road: "", distanceMeters: 967, durationSeconds: 88, ...out },
  { instruction: "Make a U-turn", road: "", distanceMeters: 967, durationSeconds: 88, ...deadEnd },
  { instruction: "Turn south", road: "", distanceMeters: 1105, durationSeconds: 100, ...out },
  { instruction: "Arrive", road: "", distanceMeters: 0, durationSeconds: 0, ...home2 },
];
const midStreet = { lat: 29.77, lng: -95.395 };

test("the same spot on a route that doubles back resolves by how far the responder has driven", () => {
  const outbound = followRoute(backtrack, backtrackSteps, midStreet, 400);
  const inbound = followRoute(backtrack, backtrackSteps, midStreet, 1000);
  assert.equal(outbound.stepIndex, 0);
  assert.equal(inbound.stepIndex, 1);
  assert.ok(inbound.drivenMeters > outbound.drivenMeters + 800);
});

test("small position jitter does not move a responder backwards onto an earlier pass", () => {
  const jitter = followRoute(backtrack, backtrackSteps, { lat: 29.77, lng: -95.3952 }, 1450);
  assert.equal(jitter.stepIndex, 1);
  assert.ok(jitter.drivenMeters > 1000);
});
