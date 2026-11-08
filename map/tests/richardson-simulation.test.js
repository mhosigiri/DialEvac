import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/richardson-simulation.js';

const sim = globalThis.RICHARDSON_SIM;

test('track is deterministic, passes near UTD, and ends after catastrophe', () => {
  assert.deepEqual(sim.positionAt(0), sim.TRACK[0]);
  assert.deepEqual(sim.positionAt(1), sim.TRACK.at(-1));
  assert.equal(sim.TRACK.some(([lng, lat]) => Math.abs(lng + 96.7502) < 0.004 && Math.abs(lat - 32.9857) < 0.004), true);
  const machine = sim.createMachine();
  assert.equal(machine.start(100).phase, 'during');
  assert.equal(machine.advance(100 + sim.DURATION_MS).phase, 'after');
  assert.equal(machine.advance(100 + sim.DURATION_MS + 1).marker, null);
});

test('two complete runs return the same path and Reset leaves no animation state', () => {
  const machine = sim.createMachine();
  const run = start => {
    const first = machine.start(start).marker;
    const middle = machine.advance(start + sim.DURATION_MS / 2).marker;
    const last = machine.advance(start + sim.DURATION_MS).marker;
    assert.equal(machine.phase, 'after');
    assert.deepEqual(machine.reset(), { phase: 'idle', staticChanged: true, marker: null });
    return [first, middle, last];
  };
  assert.deepEqual(run(1000), run(5000));
  assert.equal(machine.advance(99999).marker, null);
});

test('hurricane playback advances along the existing Gulf-to-North-Texas track', () => {
  const start = sim.hurricanePositionAt(0), middle = sim.hurricanePositionAt(0.5), end = sim.hurricanePositionAt(1);
  assert.deepEqual(start, sim.HURRICANE_TRACK[0]);
  assert.deepEqual(end, sim.HURRICANE_TRACK.at(-1));
  assert.notDeepEqual(middle, start);
  assert.notDeepEqual(middle, end);
  assert.ok(middle[0] < start[0] && middle[1] > start[1]);
});
