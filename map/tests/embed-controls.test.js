import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../assets/embed.css', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('embedded maps keep the original control panel visible and scrollable', () => {
  assert.doesNotMatch(CSS, /\.embed\s+\.panel[^{}]*\{[^}]*display:\s*none/);
  assert.match(CSS, /\.embed\s+\.panel\s*\{[^}]*display:\s*block/);
  assert.match(CSS, /\.embed\s+\.panel\s*\{[^}]*max-height:\s*calc\(100% - 24px\)/);
  assert.match(CSS, /\.embed\s+\.panel\s*\{[^}]*overflow:\s*auto/);
});

test('embedded maps retain the existing map options', () => {
  assert.match(HTML, /<aside class="panel glass" aria-label="Map controls">/);
  for (const label of ['Live warnings', 'Light', 'Map layers', 'Incident response', 'Motion']) {
    assert.match(HTML, new RegExp(`<h4>${label}</h4>`));
  }
  assert.match(HTML, /id="radar" type="checkbox"/);
  assert.match(HTML, /id="modeSeg"/);
  assert.match(HTML, /id="hazards"/);
  assert.match(HTML, /id="motionSeg"/);
});
