import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Timestamp } from "spacetimedb";
import { PickupLocation } from "../src/components/PickupLocation";
import { RoadRoute } from "../src/components/CaseCoordination";
import type { CaseRow } from "../src/lib/cases";
import type { DispatchRoute, RouteGuidance } from "../src/module_bindings/types";
import { HOUSTON_HISTORY, historicalRiderId } from "../../shared/houston-history";

const home = { address: "Demo home", lat: 29.7627, lng: -95.3973 }, vehicle = { name: "Demo unit", lat: 29.77, lng: -95.405 };
test("pickup coordinates stay explicit and directions stay inside the app", () => {
  const html = renderToStaticMarkup(<PickupLocation resident={home} responder={vehicle} onGetDirections={() => {}} />);
  for (const text of ["Resident pickup location", "29.762700, -95.397300", "29.770000, -95.405000", "Copy pickup coordinates", "Get directions"]) assert.ok(html.includes(text),text);
});
test("a moved resident hides old road metrics and guidance until the route is refreshed", () => {
  const row = { household: { ...home, lat: home.lat + .01 }, assignment: { id: 1n }, match: { vehicle } } as CaseRow;
  const route = { assignmentId: 1n, revision: 1n, state: "ready", originLat: vehicle.lat, originLng: vehicle.lng, destinationLat: home.lat, destinationLng: home.lng,
    distanceMeters: 1400, durationSeconds: 200, updatedAt: new Timestamp(1_000_000n) } as DispatchRoute;
  const guidance = { assignmentId: 1n, revision: 1n, state: "ready", summary: "Stale AI route brief", model: "gemini-test", stepsJson: "[]" } as RouteGuidance;
  const html = renderToStaticMarkup(<RoadRoute row={row} route={route} guidance={guidance} disabled={false} send={() => {}} />);
  assert.ok(html.includes("location changed")); assert.ok(!html.includes("Stale AI route brief")); assert.ok(!html.includes("Drive time"));
});

test("a current road route shows an in-app street map with only its own Gemini overlay", () => {
  const row = { household: home, assignment: { id: 1n }, match: { vehicle } } as CaseRow;
  const route = { assignmentId: 1n, revision: 2n, state: "ready", originLat: vehicle.lat, originLng: vehicle.lng, destinationLat: home.lat, destinationLng: home.lng,
    points: [vehicle, home], source: "osmnx", updatedAt: new Timestamp(1_000_000n) } as DispatchRoute;
  const guidance = { assignmentId: 1n, revision: 2n, state: "ready", summary: "Use Washington Avenue", model: "gemini-test", stepsJson: "[]" } as RouteGuidance;
  const render = (g: RouteGuidance) => renderToStaticMarkup(<RoadRoute row={row} route={route} guidance={g} disabled={false} send={() => {}} />);
  const html = render(guidance);
  assert.ok(html.includes('title="OpenStreetMap route to pickup"'));
  assert.ok(html.includes('Gemini map overlay'));
  assert.ok(html.includes('Use Washington Avenue'));
  assert.ok(!html.includes('google.com/maps'));
  assert.ok(!render({ ...guidance, assignmentId: 99n }).includes('Use Washington Avenue'));
  assert.ok(!render({ ...guidance, revision: 1n }).includes('Use Washington Avenue'));
});

test("historical locations retain provenance and request a responder before calculating directions", () => {
  const report = HOUSTON_HISTORY[0];
  const html = renderToStaticMarkup(<PickupLocation resident={{ ...report, riderId: historicalRiderId(report.caseNumber) }} />);
  for (const text of [report.address, report.caseNumber, report.reportedAt.slice(0, 10), "Assign a responder", "Get directions"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("google.com/maps"));
  assert.ok(html.includes("disabled"));
});
