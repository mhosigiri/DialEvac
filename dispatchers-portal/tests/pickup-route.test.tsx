import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Timestamp } from "spacetimedb";
import { PickupLocation } from "../src/components/PickupLocation";
import { RoadRoute } from "../src/components/CaseCoordination";
import type { CaseRow } from "../src/lib/cases";
import type { DispatchRoute, RouteGuidance } from "../src/module_bindings/types";

const home = { address: "Demo home", lat: 29.7627, lng: -95.3973 }, vehicle = { name: "Demo unit", lat: 29.77, lng: -95.405 };
test("pickup coordinates are explicit and external directions use responder origin and resident destination", () => {
  const html = renderToStaticMarkup(<PickupLocation resident={home} responder={vehicle} />);
  for (const text of ["Resident pickup location", "29.762700, -95.397300", "29.770000, -95.405000", "Copy pickup coordinates", "origin=29.77%2C-95.405", "destination=29.7627%2C-95.3973"]) assert.ok(html.includes(text),text);
});
test("a moved resident hides old road metrics and guidance until the route is refreshed", () => {
  const row = { household: { ...home, lat: home.lat + .01 }, assignment: { id: 1n }, match: { vehicle } } as CaseRow;
  const route = { assignmentId: 1n, revision: 1n, state: "ready", originLat: vehicle.lat, originLng: vehicle.lng, destinationLat: home.lat, destinationLng: home.lng,
    distanceMeters: 1400, durationSeconds: 200, updatedAt: new Timestamp(1_000_000n) } as DispatchRoute;
  const guidance = { assignmentId: 1n, revision: 1n, state: "ready", summary: "Stale AI route brief", model: "gemini-test", stepsJson: "[]" } as RouteGuidance;
  const html = renderToStaticMarkup(<RoadRoute row={row} route={route} guidance={guidance} disabled={false} send={() => {}} />);
  assert.ok(html.includes("location changed")); assert.ok(!html.includes("Stale AI route brief")); assert.ok(!html.includes("Drive time"));
});
