import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchGeminiRoute } from "../src/gemini-route";
import { fetchRoadDirections } from "../src/road-router";

const origin = { lat: 29.77, lng: -95.405 }, destination = { lat: 29.7627, lng: -95.3973 };
const route = { points: [origin, destination], distanceMeters: 1400, durationSeconds: 200, steps: [{ instruction: "Turn right on Test Street", road: "Test Street", distanceMeters: 1400, durationSeconds: 200, ...origin }] };

test("Gemini invokes a verified routing tool with immutable application coordinates, then summarizes its real directions", async t => {
  const previous = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "mock-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  const requests: Record<string, unknown>[] = [];
  const mock: typeof fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify(requests.length === 1 ? { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_driving_directions", args: {} }, thoughtSignature: "preserve-this" }] } }] } :
      { modelVersion: "gemini-test", candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ summary: "Follow Test Street. No live hazard clearance is available." }) }] } }] }));
  };
  const result = await fetchGeminiRoute(origin, destination, mock, async (from, to) => { assert.deepEqual(from, origin); assert.deepEqual(to, destination); return route; });
  assert.deepEqual(result.points, route.points); assert.equal(result.model, "gemini-test"); assert.ok(result.summary);
  assert.ok(JSON.stringify(requests[1]).includes("preserve-this"));
  assert.ok(JSON.stringify(requests[1]).includes("Test Street"));
});

test("Gemini cannot substitute coordinates, and a failed summary keeps verified road directions available", async t => {
  const previous = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "mock-key";
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  let routed = 0;
  const call = (args: object) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_driving_directions", args } }] } }] });
  await assert.rejects(fetchGeminiRoute(origin, destination, async () => new Response(JSON.stringify(call({ origin: { lat: 0, lng: 0 } }))), async () => { routed++; return route; }), /unsupported/);
  assert.equal(routed, 0);
  let requests = 0;
  const result = await fetchGeminiRoute(origin, destination, async () => ++requests === 1 ? new Response(JSON.stringify(call({}))) : new Response("down", { status: 503 }), async () => route);
  assert.deepEqual(result.steps, route.steps); assert.equal(result.summary, undefined); assert.match(result.error!, /unavailable/);
});

test("road directions retain only the router's actual maneuvers and street names", async () => {
  const raw = { code: "Ok", source: "osmnx", routes: [{ distance: 1400, duration: 200, geometry: { type: "LineString", coordinates: [[origin.lng, origin.lat], [destination.lng, destination.lat]] }, legs: [{ steps: [
    { name: "Test Street", distance: 1400, duration: 200, maneuver: { type: "turn", modifier: "right", location: [origin.lng, origin.lat] } },
    { name: "", distance: 0, duration: 0, maneuver: { type: "arrive", location: [destination.lng, destination.lat] } },
  ] }] }] };
  const r = await fetchRoadDirections(origin, destination, async url => { assert.match(String(url), /steps=true/); return new Response(JSON.stringify(raw)); });
  assert.equal(r.steps[0].instruction, "Turn right on Test Street"); assert.equal(r.steps[1].instruction, "Arrive at the destination");
});
