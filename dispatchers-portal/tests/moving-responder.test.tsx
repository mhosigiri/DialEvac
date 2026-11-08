import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Timestamp } from "spacetimedb";
import { RoadRoute } from "../src/components/CaseCoordination";
import type { CaseRow } from "../src/lib/cases";
import type { DispatchRoute, RouteGuidance } from "../src/module_bindings/types";

const start = { lat: 29.77, lng: -95.405 }, corner = { lat: 29.77, lng: -95.3973 }, home = { address: "Demo home", lat: 29.7627, lng: -95.3973 };
const route = { assignmentId: 1n, revision: 1n, state: "ready", originLat: start.lat, originLng: start.lng, destinationLat: home.lat, destinationLng: home.lng,
  points: [start, corner, home], distanceMeters: 1560, durationSeconds: 200, updatedAt: new Timestamp(1_000_000n) } as DispatchRoute;
const guidance = { assignmentId: 1n, revision: 1n, state: "ready", summary: "Current route brief", model: "gemini-test", stepsJson: "[]" } as RouteGuidance;
const viewWithUnitAt = (position: { lat: number; lng: number }) => renderToStaticMarkup(
  <RoadRoute row={{ household: home, assignment: { id: 1n }, match: { vehicle: { name: "Demo unit", ...position } } } as CaseRow} route={route} guidance={guidance} disabled={false} send={() => {}} />,
);

test("the dispatcher keeps the route while the responder drives it", () => {
  const html = viewWithUnitAt({ lat: start.lat, lng: (start.lng + corner.lng) / 2 });
  assert.ok(!html.includes("location changed"));
  assert.ok(html.includes("Current route brief"));
});

test("the dispatcher is told to refresh once the responder leaves the route", () => {
  const html = viewWithUnitAt({ lat: start.lat + 0.02, lng: start.lng });
  assert.ok(html.includes("location changed"));
  assert.ok(!html.includes("Current route brief"));
});
