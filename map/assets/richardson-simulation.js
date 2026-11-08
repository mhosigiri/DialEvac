// Deterministic, map-only Richardson tornado scenario. This file owns no timers; the
// MapLibre animation loop supplies timestamps so Reset cannot leave work behind.
'use strict';
(() => {
  const LABEL = 'Richardson, TX';
  const CENTER = [-96.758, 32.977];
  const DURATION_MS = 12000;
  const TRACK = [
    [-96.8060, 32.9460],
    [-96.7820, 32.9630],
    [-96.7525, 32.9848], // immediately south of UT Dallas
    [-96.7270, 33.0000],
    [-96.7010, 33.0160],
  ];
  const HURRICANE_TRACK = [[-95.3, 29.3], [-95.95, 30.55], [-96.5, 31.8], [-96.75, 33.0]];
  const IMPACT_RING = [
    [-96.8110, 32.9510], [-96.7870, 32.9680], [-96.7575, 32.9900],
    [-96.7300, 33.0060], [-96.7045, 33.0210], [-96.6970, 33.0110],
    [-96.7240, 32.9940], [-96.7475, 32.9795], [-96.7770, 32.9570],
    [-96.8010, 32.9400], [-96.8110, 32.9510],
  ];
  const CHECKS = [
    { coordinates: [-96.7528, 32.9850], label: 'Shelter-access check', reason: 'Wheelchair-accessible ride' },
    { coordinates: [-96.7710, 32.9715], label: 'Welfare check', reason: 'No response after 2 attempts' },
    { coordinates: [-96.7350, 32.9950], label: 'Welfare check', reason: 'Power-dependent medical device' },
  ];

  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const pointCollection = coordinates => ({
    type: 'FeatureCollection',
    features: coordinates ? [{ type: 'Feature', properties: { label: LABEL }, geometry: { type: 'Point', coordinates } }] : [],
  });
  const staticCollection = () => ({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'impact', label: LABEL }, geometry: { type: 'Polygon', coordinates: [IMPACT_RING] } },
      { type: 'Feature', properties: { kind: 'track', label: LABEL }, geometry: { type: 'LineString', coordinates: TRACK } },
      { type: 'Feature', properties: { kind: 'label', label: LABEL }, geometry: { type: 'Point', coordinates: CENTER } },
      ...CHECKS.map(check => ({ type: 'Feature', properties: { kind: 'check', label: check.label, reason: check.reason }, geometry: { type: 'Point', coordinates: check.coordinates } })),
    ],
  });

  function positionAt(progress) {
    const p = Math.max(0, Math.min(1, progress));
    const scaled = p * (TRACK.length - 1);
    const segment = Math.min(TRACK.length - 2, Math.floor(scaled));
    const local = p === 1 ? 1 : scaled - segment;
    const a = TRACK[segment], b = TRACK[segment + 1];
    return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
  }
  function hurricanePositionAt(progress) {
    const p = Math.max(0, Math.min(1, progress));
    const scaled = p * (HURRICANE_TRACK.length - 1), segment = Math.min(HURRICANE_TRACK.length - 2, Math.floor(scaled)), local = p === 1 ? 1 : scaled - segment;
    const a = HURRICANE_TRACK[segment], b = HURRICANE_TRACK[segment + 1];
    return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
  }

  function createMachine() {
    let phase = 'idle';
    let startedAt = 0;
    return {
      get phase() { return phase; },
      start(now) {
        startedAt = now;
        phase = 'during';
        return { phase, staticChanged: true, marker: positionAt(0), centerCamera: true, seed: true };
      },
      advance(now) {
        if (phase !== 'during') return { phase, staticChanged: false, marker: null };
        const progress = Math.max(0, (now - startedAt) / DURATION_MS);
        if (progress >= 1) phase = 'after';
        return { phase, staticChanged: false, marker: positionAt(progress), completed: phase === 'after' };
      },
      reset() {
        phase = 'idle';
        startedAt = 0;
        return { phase, staticChanged: true, marker: null };
      },
    };
  }

  globalThis.RICHARDSON_SIM = Object.freeze({ LABEL, CENTER, DURATION_MS, TRACK, HURRICANE_TRACK, IMPACT_RING, CHECKS, empty, pointCollection, staticCollection, positionAt, hurricanePositionAt, createMachine });
})();
