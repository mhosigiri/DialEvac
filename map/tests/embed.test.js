import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../assets/embed.js', import.meta.url), 'utf8');
const CASE = { id: '1', label: 'Home', lat: 29.76, lng: -95.39, severity: 'critical' };
const ROUTE = [{ lat: 29.76, lng: -95.39 }, { lat: 29.8, lng: -95.4 }];

// Only the parts of the browser and MapLibre that embed.js touches while the map is running.
function loadEmbed() {
  const listeners = {};
  const calls = { fit: [], jump: [], resize: 0 };
  const parent = { messages: [], postMessage(message) { this.messages.push(message); } };
  const source = { setData() {} };
  const map = {
    getLayer: () => true,
    getSource: () => source,
    getStyle: () => ({ layers: [] }),
    getZoom: () => 10,
    flyTo() {},
    fitBounds: (bounds, options) => calls.fit.push({ bounds, options }),
    jumpTo: view => calls.jump.push(view),
    resize: () => { calls.resize += 1; },
  };
  class Marker {
    setLngLat(lngLat) { this.lngLat = lngLat; return this; }
    addTo() { return this; }
    remove() {}
    getLngLat() { return this.lngLat; }
  }
  const sandbox = {
    URLSearchParams,
    setTimeout,
    location: { search: '?embed=1' },
    innerWidth: 1200,
    innerHeight: 800,
    parent,
    maplibregl: { Marker },
    __map: map,
    __dialevacState: { ready: true, motion: false },
    addEventListener: (type, listener) => { (listeners[type] ??= []).push(listener); },
    document: {
      documentElement: { classList: { add() {} } },
      createElement: () => ({ append() {}, textContent: '' }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  const receive = (data, from = parent) => listeners.message[0]({ source: from, data });
  const press = key => listeners.keydown[0]({ key });
  return { calls, parent, receive, press, sandbox };
}

const REFIT = { type: 'dialevac:refit', width: 1200, height: 800 };

test('refit frames the cases again at the new size', () => {
  const { calls, receive } = loadEmbed();
  receive({ type: 'dialevac:cases', cases: [CASE] });
  receive({ type: 'dialevac:cases', cases: [CASE] });
  assert.equal(calls.fit.length, 1);
  receive(REFIT);
  assert.equal(calls.resize, 1);
  assert.equal(calls.fit.length, 2);
});

test('refit waits until this window has its new size', async () => {
  const { calls, receive, sandbox } = loadEmbed();
  receive({ type: 'dialevac:cases', cases: [CASE] });
  receive({ ...REFIT, width: 1600, height: 1000 });
  assert.equal(calls.resize, 0);
  sandbox.innerWidth = 1600;
  sandbox.innerHeight = 1000;
  await wait(60);
  assert.equal(calls.resize, 1);
  assert.equal(calls.fit.length, 2);
});

test('refit keeps an open case centered instead of zooming back out', () => {
  const { calls, receive } = loadEmbed();
  receive({ type: 'dialevac:cases', cases: [CASE] });
  receive({ type: 'dialevac:select', selection: CASE });
  receive(REFIT);
  assert.equal(calls.fit.length, 1);
  assert.equal(calls.jump.length, 1);
});

test('refit frames a route around the case file covering the map', () => {
  const { calls, receive } = loadEmbed();
  receive({ type: 'dialevac:route', points: ROUTE, coveredRight: 300 });
  receive(REFIT);
  assert.equal(calls.fit.length, 2);
  assert.equal(calls.fit[1].options.padding.right, 364);
});

test('refit ignores messages from other windows', () => {
  const { calls, receive } = loadEmbed();
  receive(REFIT, {});
  assert.equal(calls.resize, 0);
});

test('only Escape is forwarded to the portal', () => {
  const { parent, press } = loadEmbed();
  press('a');
  assert.equal(parent.messages.length, 0);
  press('Escape');
  assert.equal(parent.messages[0].type, 'dialevac:escape');
});
