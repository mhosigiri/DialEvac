import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDriverStops } from "../src/lib/driver-state";
import { TurnByTurnNav } from "../src/components/TurnByTurnNav";
import type { Assignment, DispatchRoute, Household, Request, RouteGuidance, Vehicle } from "../src/module_bindings/types";

const start = { lat: 29.77, lng: -95.405 };
const corner = { lat: 29.77, lng: -95.3973 };
const pickup = { lat: 29.7627, lng: -95.3973 };

const home = { id: 1n, name: "Demo resident", address: "1 Main", ...pickup, simulated: true } as Household;
const request = { id: 3n, householdId: 1n, status: "en_route", people: 1, mobility: "walks", assistance: "none" } as Request;
const assignment = { id: 4n, requestId: 3n, vehicleId: 2n, status: "accepted", stopOrder: 1 } as Assignment;
const stop = buildDriverStops([assignment], [request], [home], [], 2n)[0];
const route = { assignmentId: 4n, revision: 1n, state: "ready", originLat: start.lat, originLng: start.lng, destinationLat: pickup.lat, destinationLng: pickup.lng,
  points: [start, corner, pickup], distanceMeters: 1560, durationSeconds: 200 } as DispatchRoute;
const guidance = { assignmentId: 4n, revision: 1n, state: "ready", summary: "Current route brief", model: "gemini-test",
  stepsJson: JSON.stringify([{ instruction: "Turn right on Main Street", road: "Main Street", distanceMeters: 750, durationSeconds: 90, ...start }]) } as RouteGuidance;

const navAt = (position: { lat: number; lng: number }, s = stop) =>
  renderToStaticMarkup(<TurnByTurnNav stop={s} vehicle={{ id: 2n, name: "Unit", ...position } as Vehicle} route={route} guidance={guidance} roadClosures={[]} onRequestRoute={() => {}} busy={false} />);

test("directions stay on screen while the responder drives the route", () => {
  const html = navAt({ lat: start.lat, lng: (start.lng + corner.lng) / 2 });
  assert.ok(html.includes("Turn right on Main Street"));
  assert.ok(html.includes("Current route brief"));
  assert.ok(!html.includes("Get a current road route"));
});

test("directions are replaced by a route request once the responder leaves the route", () => {
  const html = navAt({ lat: start.lat + 0.02, lng: start.lng });
  assert.ok(!html.includes("Turn right on Main Street"));
  assert.ok(!html.includes("Current route brief"));
  assert.ok(html.includes("Get a current road route"));
});

test("a moved pickup invalidates directions even with the responder on the old route", () => {
  const html = navAt(start, { ...stop, lat: pickup.lat + 0.0001 });
  assert.ok(!html.includes("Current route brief"));
  assert.ok(html.includes("Get a current road route"));
});
