import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRoadRoute } from "../src/road-router";
import { sameRoadGeometry } from "../../shared/routing";

test("route service uses real OSRM GeoJSON order and refuses malformed or failed provider responses", async () => {
  let requested = "";
  const fetcher: typeof fetch = async input => { requested = String(input); return new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 1200, duration: 180,
    geometry: { type: "LineString", coordinates: [[-95.405, 29.77], [-95.3983, 29.7617]] } }] })); };
  const result = await fetchRoadRoute({ lat: 29.77, lng: -95.405 }, { lat: 29.7617, lng: -95.3983 }, fetcher);
  assert.match(requested, /-95\.405,29\.77;-95\.3983,29\.7617/);
  assert.deepEqual(result.points[0], { lat: 29.77, lng: -95.405 });
  assert.equal(result.distanceMeters, 1200);
  await assert.rejects(fetchRoadRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, async () => new Response("", { status: 503 })), /unavailable/);
  await assert.rejects(fetchRoadRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, async () => new Response(JSON.stringify({ code: "NoRoute" }))), /Invalid/);
});

test("route geometry comparison tolerates a repeated waypoint but rejects a genuinely different road path", () => {
  const a = { lat: 29.77, lng: -95.405 }, b = { lat: 29.7627, lng: -95.3973 };
  assert.equal(sameRoadGeometry([a, b, b], [a, b]), true);
  assert.equal(sameRoadGeometry([a, { ...b, lat: b.lat + .001 }, b], [a, b]), false);
});
