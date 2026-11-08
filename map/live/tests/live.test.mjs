// Runs the pure parts of assets/live.js in a bare context: warning filtering, feed wording, vehicle status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load(search = '') {
  const window = { addEventListener() {} };
  const ctx = { window, location: { search }, URLSearchParams, document: { getElementById: () => null }, PAL: {}, console };
  vm.runInNewContext(readFileSync(new URL('../../assets/live.js', import.meta.url), 'utf8'), ctx);
  return window.LIVE._pure;
}

const NOW = Date.parse('2026-11-08T03:30:00Z');
const MIN = 60_000;
const poly = JSON.stringify({ type: 'Polygon', coordinates: [[[-96.8, 32.9], [-96.7, 32.9], [-96.7, 33], [-96.8, 32.9]]] });
const warn = (key, over = {}) => ({ key, alertId: key, source: 'nws', event: 'Tornado Warning', headline: 'h', areaDescription: 'Dallas, TX', geometry: poly, issuedAt: NOW - 10 * MIN, effectiveAt: NOW - 10 * MIN, expiresAt: NOW + 30 * MIN, status: 'Actual', severity: 'Extreme', officialUrl: 'https://api.weather.gov/alerts/x', ...over });

test('shows only unexpired tornado warnings, soonest expiry first', () => {
  const { shownWarnings } = load();
  const rows = [warn('late', { expiresAt: NOW + 50 * MIN }), warn('soon', { expiresAt: NOW + 5 * MIN }), warn('gone', { expiresAt: NOW - MIN }), warn('heat', { event: 'Heat Advisory' }), warn('open', { expiresAt: null })];
  assert.deepEqual([...shownWarnings(rows, NOW).map(w => w.key)], ['soon', 'late', 'open']);
});

test('?events=all shows every alert type', () => {
  const { shownWarnings } = load('?events=all');
  assert.equal(shownWarnings([warn('a'), warn('b', { event: 'Heat Advisory' })], NOW).length, 2);
});

test('a warning without a polygon is listed but not drawn', () => {
  const { collections, shownWarnings } = load();
  const snap = { warnings: [warn('a'), warn('b', { geometry: '' }), warn('c', { geometry: '{bad' })], feeds: [], zones: [], vehicles: [], assignments: [] };
  assert.equal(shownWarnings(snap.warnings, NOW).length, 3);
  assert.deepEqual([...collections(snap, NOW).warn.features.map(f => f.properties.key)], ["a"]);
});

test('feed wording tells no warnings apart from unable to refresh', () => {
  const { feedSummary } = load();
  const feed = over => [{ source: 'nws', state: 'current', lastSuccessfulPollAt: NOW - MIN, lastAttemptAt: NOW - MIN, error: null, ...over }];
  assert.match(feedSummary(feed(), 'live', 0, NOW).text, /^No active tornado warnings/);
  assert.equal(feedSummary(feed(), 'live', 0, NOW).tone, 'ok');
  assert.match(feedSummary(feed(), 'live', 2, NOW).text, /^2 active tornado warnings/);
  assert.match(feedSummary(feed({ state: 'stale', error: 'NWS answered 503' }), 'live', 0, NOW).text, /^Unable to refresh warnings/);
  assert.match(feedSummary(feed({ lastSuccessfulPollAt: NOW - 20 * MIN }), 'live', 0, NOW).text, /^Unable to refresh warnings/);
  assert.match(feedSummary(feed({ state: 'current', lastSuccessfulPollAt: null }), 'live', 0, NOW).text, /last update never/);
  assert.match(feedSummary(feed({ state: 'loading' }), 'live', 0, NOW).text, /loading/);
  assert.match(feedSummary(feed({ state: 'off' }), 'live', 0, NOW).text, /off/);
  assert.match(feedSummary([], 'live', 0, NOW).text, /Waiting/);
  assert.match(feedSummary(feed(), 'disconnected', 0, NOW).text, /offline/);
});

test('vehicle status comes from its live assignment', () => {
  const { vehicleStatus, collections } = load();
  const a = [{ id: '1', vehicleId: '1', status: 'accepted' }, { id: '2', vehicleId: '2', status: 'offered' }, { id: '3', vehicleId: '3', status: 'completed' }];
  assert.equal(vehicleStatus('1', a), 'en_route');
  assert.equal(vehicleStatus('2', a), 'assigned');
  assert.equal(vehicleStatus('3', a), 'available');
  assert.equal(vehicleStatus('4', a), 'available');
  const snap = { warnings: [], feeds: [], zones: [], assignments: a, vehicles: [{ id: '1', name: 'Van 1', kind: 'van', lat: 33, lng: -96.7, simulated: true, seenAt: NOW }] };
  const f = collections(snap, NOW).veh.features[0];
  assert.deepEqual([...f.geometry.coordinates], [-96.7, 33]);
  assert.equal(f.properties.label, 'Van 1 · En route · SIM');
  assert.ok(!('driverName' in f.properties));
});

test('the simulated zone is drawn as its own labelled layer', () => {
  const { collections } = load();
  const snap = { warnings: [], feeds: [], vehicles: [], assignments: [], zones: [{ id: '1', name: 'Simulated tornado warning', event: 'Tornado Warning', rings: JSON.stringify([[[-96.8, 32.9], [-96.7, 32.9], [-96.7, 33], [-96.8, 32.9]]]) }] };
  const c = collections(snap, NOW);
  assert.equal(c.sim.features.length, 1);
  assert.equal(c.sim.features[0].properties.label, 'SIMULATED · Tornado Warning');
  assert.equal(c.warn.features.length, 0);
});
