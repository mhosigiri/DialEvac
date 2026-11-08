import { test } from "node:test";
import assert from "node:assert/strict";
import { bindDirectionsMap, directionsMapUrl } from "../../shared/directions-map";

test("a cold map receives the exact OSMnx route again on its own ready handshake", () => {
  const listeners = new Map<string, (event: any) => void>();
  const posts: { message: any; origin: string }[] = [];
  const contentWindow = { postMessage: (message: any, origin: string) => posts.push({ message, origin }) };
  const frame = { src: "http://localhost:4178/index.html", contentWindow,
    addEventListener: (name: string, fn: any) => listeners.set(`frame:${name}`, fn),
    removeEventListener: (name: string) => listeners.delete(`frame:${name}`) } as unknown as HTMLIFrameElement;
  const oldWindow = (globalThis as any).window;
  (globalThis as any).window = { addEventListener: (name: string, fn: any) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  try {
    const origin = { lat: 29.77, lng: -95.405, label: "Responder" }, destination = { lat: 29.76123664, lng: -95.39271099, label: "502 MONTROSE" };
    const points = [origin, { lat: 29.769, lng: -95.4 }, destination];
    const cleanup = bindDirectionsMap(frame, { origin, destination, points, coveredBottom: 120 });
    assert.deepEqual(posts[1].message.points, points);
    posts.length = 0;
    listeners.get("message")!({ source: {}, origin: "http://localhost:4178", data: { type: "dialevac:ready" } });
    assert.equal(posts.length, 0);
    listeners.get("message")!({ source: contentWindow, origin: "https://unrelated.example", data: { type: "dialevac:ready" } });
    assert.equal(posts.length, 0);
    listeners.get("message")!({ source: contentWindow, origin: "http://localhost:4178", data: { type: "dialevac:ready" } });
    assert.deepEqual(posts[0].message.selection, destination);
    assert.deepEqual(posts[1].message.points, points);
    assert.equal(posts[1].message.coveredBottom, 120);
    assert.ok(posts.every(post => post.origin === "http://localhost:4178"));
    cleanup();
    assert.equal(listeners.size, 0);
  } finally { if (oldWindow === undefined) delete (globalThis as any).window; else (globalThis as any).window = oldWindow; }
});

test("directions stay on the app's map server and keep the selected database", () => {
  const url = new URL(directionsMapUrl(undefined, "http://192.168.1.5:3003/", "wss://maincloud.spacetimedb.com", "hackutd-richardson"));
  assert.equal(url.origin, "http://192.168.1.5:4178");
  assert.equal(url.searchParams.get("db"), "hackutd-richardson");
  assert.equal(url.searchParams.get("directions"), "1");
});
