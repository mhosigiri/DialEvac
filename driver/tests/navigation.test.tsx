import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDriverStops } from "../src/lib/driver-state";
import { TurnByTurnNav } from "../src/components/TurnByTurnNav";
import { HOUSTON_HISTORY, historicalRiderId } from "../../shared/houston-history";
import type { Assignment, Household, Request, Vehicle, DispatchRoute, RouteGuidance } from "../src/module_bindings/types";

const report = HOUSTON_HISTORY[0];
const home = { ...report, id: 1n, name: "Demo household", riderId: historicalRiderId(report.caseNumber), phone: "+18325550100", simulated: true } as Household;
const vehicle = { id: 2n, name: "Demo responder", lat: 29.77, lng: -95.405 } as Vehicle;
const request = { id: 3n, householdId: 1n, status: "driver_accepted", people: 2, mobility: "walks", assistance: "none" } as Request;
const assignment = { id: 4n, requestId: 3n, vehicleId: 2n, status: "accepted", stopOrder: 1 } as Assignment;
const stop = buildDriverStops([assignment], [request], [home], [], vehicle.id)[0];

test("an accepted historical pickup keeps its exact destination, attribution and in-app navigation", () => {
  assert.equal(stop.address, report.address);
  assert.equal(stop.lat, report.lat);
  assert.equal(stop.lng, report.lng);
  assert.equal(stop.phone, undefined);
  const html = renderToStaticMarkup(<TurnByTurnNav stop={stop} vehicle={vehicle} roadClosures={[]} onRequestRoute={() => {}} busy={false} />);
  for (const text of [report.address, report.caseNumber, "OpenStreetMap driving navigation", "Get directions"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("tel:"));
  assert.ok(!html.includes("google.com/maps"));
});

test("moving a pickup hides the old driver route metrics, map and guidance", () => {
  const route = { assignmentId: assignment.id, revision: 1n, state: "ready", originLat: vehicle.lat, originLng: vehicle.lng,
    destinationLat: home.lat, destinationLng: home.lng, points: [{ lat: vehicle.lat, lng: vehicle.lng }, { lat: home.lat, lng: home.lng }], distanceMeters: 12345, durationSeconds: 777 } as DispatchRoute;
  const guidance = { assignmentId: assignment.id, revision: 1n, summary: "Outdated route brief", stepsJson: "[]" } as RouteGuidance;
  const html = renderToStaticMarkup(<TurnByTurnNav stop={{ ...stop, lat: stop.lat + .01 }} vehicle={vehicle} route={route} guidance={guidance} roadClosures={[]} onRequestRoute={() => {}} busy={false} />);
  assert.ok(!html.includes("Outdated route brief"));
  assert.ok(!html.includes("7.7 mi"));
  assert.ok(html.includes("Get a current road route"));
});
