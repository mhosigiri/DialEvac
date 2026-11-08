import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const SOURCE = readFileSync(new URL('../assets/incident-editor.js', import.meta.url), 'utf8');

test('drawing sends clicked coordinates only in an active edit mode and renders the draft and closures', () => {
  const listeners = {}, sources = new Map(), messages = [], canvas = { style: {} };
  const parent = { postMessage: message => messages.push(message) };
  const map = { getSource: id => sources.get(id), addSource: (id, value) => sources.set(id, { data: value.data, setData(data) { this.data = data; } }), addLayer() {}, getCanvas: () => canvas,
    doubleClickZoom: { disable() {}, enable() {} }, on: (type, fn) => { listeners['map:' + type] = fn; } };
  const sandbox = { URLSearchParams, location: { search: '?embed=1' }, __map: map, __dialevacState: { ready: true }, parent, addEventListener: (type, fn) => { listeners[type] = fn; } };
  sandbox.window = sandbox;
  vm.createContext(sandbox); vm.runInContext(SOURCE, sandbox);
  listeners['dialevac:map-ready']();
  const click = () => listeners['map:click']({ lngLat: { lat: 29.76, lng: -95.39 } });
  click(); assert.equal(messages.length, 0);
  const vertices = [{ lat: 29.75, lng: -95.4 }, { lat: 29.77, lng: -95.4 }, { lat: 29.77, lng: -95.38 }];
  listeners.message({ source: parent, data: { type: 'dialevac:incident-editor', mode: 'zone', vertices, closures: [{ lat: 29.76, lng: -95.39, street: 'Montrose' }] } });
  click(); assert.equal(messages[0].mode, 'zone'); assert.equal(messages[0].point.lng, -95.39);
  assert.equal(sources.get('incident-editor-draft').data.features[0].geometry.type, 'Polygon');
  assert.equal(sources.get('incident-editor-closures').data.features.length, 1);
  listeners.message({ source: {}, data: { type: 'dialevac:incident-editor', mode: 'none' } });
  click(); assert.equal(messages.length, 2, 'a foreign window cannot disable the selected edit mode');
  listeners.message({ source: parent, data: { type: 'dialevac:incident-editor', mode: 'none' } });
  click(); assert.equal(messages.length, 2);
});
