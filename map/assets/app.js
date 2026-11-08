// App controller: light mode (auto by sun / day / night), hazards, motion, animation loop.
'use strict';
const $ = s => document.querySelector(s);
const LAT = 32.977, LNG = -96.758;
const state = { pref: 'auto', mode: null, motion: !matchMedia('(prefers-reduced-motion: reduce)').matches, hazards: new Set(), ready: false, t0: performance.now() };
const HAZARDS = []; // registered by hazard modules: { id, label, note, enable(map), disable(map), layers(mode), sources(), tick(map,t,dt) -> hud text }
let map;

// ---------- light mode ----------
function sunMode(now = new Date()) { return SUN.elevation(now, LAT, LNG) > -0.833 ? 'day' : 'night'; }
function sunText() {
  const now = new Date(), next = SUN.nextCrossing(now, LAT, LNG), fmt = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const el = SUN.elevation(now, LAT, LNG).toFixed(0);
  const nxt = next ? `${next.rising ? 'sunrise' : 'sunset'} ${fmt(next.time)}` : '';
  return state.pref === 'auto' ? `Auto: sun ${el}° → ${PAL[state.mode].name.toLowerCase()} · ${nxt}` : `Manual: ${PAL[state.mode].name.toLowerCase()} · real ${nxt}`;
}
function fullStyle(mode) {
  const s = buildStyle(mode);
  for (const h of HAZARDS) if (state.hazards.has(h.id)) h.addTo(s, mode, PAL[mode]);
  if (window.LIVE) LIVE.addTo(s, mode); // live warnings, simulated zone and vehicles (assets/live.js)
  // MapLibre 5.6 globe projection mis-draws large animated canvas sources (the hurricane covers the map); flat Mercator is correct
  if (state.hazards.has('hurricane')) s.projection = { type: 'mercator' };
  return s;
}
function applyMode(force) {
  const mode = state.pref === 'auto' ? sunMode() : state.pref;
  if (mode === state.mode && !force) { $('#sun').textContent = sunText(); return; }
  state.mode = mode;
  const P = PAL[mode], r = document.documentElement.style;
  for (const k of ['bg', 'ink', 'sub', 'line', 'accent']) r.setProperty('--' + k, P.ui[k]);
  r.setProperty('--bg-solid', P.ui.bg.replace(/rgba?\(([^)]+),[^,]+\)$/, 'rgb($1)')); r.setProperty('--fx', P.fx);
  document.body.style.background = P.bg;
  $('#legend').innerHTML = Object.entries(P.status).map(([k, c]) => `<span><i style="--c:${c};--stroke:${P.hhStroke}"></i>${k[0].toUpperCase() + k.slice(1)}</span>`).join('') + '<span style="opacity:.65">· synthetic</span>';
  document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === state.pref)));
  $('#sun').textContent = sunText();
  if (map) restyle();
}
function restyle(after) {
  state.ready = false;
  const st = fullStyle(state.mode);
  map.setStyle(st, { diff: true });
  // style diffs do not apply projection changes, and setProjection throws until the style is loaded
  // (a projection change also cancels camera animations, so callers' fly-tos run in `after`)
  const proj = () => { try { map.setProjection(st.projection); } catch (e) { return setTimeout(proj, 100); } after && after(); };
  proj();
  markReady();
}
function markReady() { const go = () => { state.ready = true; }; if (map.isStyleLoaded()) go(); else map.once('styledata', go); setTimeout(go, 1500); }

// ---------- hazards UI ----------
function renderHazards() {
  $('#hazards').innerHTML = HAZARDS.map(h => `<button class="chip" data-h="${h.id}" aria-pressed="${state.hazards.has(h.id)}"><i></i>${h.label}<small>${h.note || ''}</small></button>`).join('');
}
$('#hazards').addEventListener('click', e => {
  const b = e.target.closest('[data-h]'); if (!b) return;
  const h = HAZARDS.find(x => x.id === b.dataset.h), on = !state.hazards.has(h.id);
  on ? state.hazards.add(h.id) : state.hazards.delete(h.id);
  renderHazards(); restyle(() => h.toggled && h.toggled(map, on));
  if (!state.hazards.has('storm') && !state.hazards.has('hurricane') && window.WX) WX.clearRain();
});
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; state.pref = b.dataset.m; applyMode(true); });
function setMotion(on) { state.motion = on; document.querySelectorAll('#motionSeg button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'on') === on))); }
$('#motionSeg').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setMotion(b.dataset.v === 'on'); });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => setMotion(!e.matches));

// ---------- animation loop ----------
const pulseR = z => 6 + (Math.min(Math.max(z, 11), 17) - 11) / 6 * 22;
let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!map || !state.ready) return;
  const t = now / 1000, huds = [];
  try {
    if (map.getLayer('pulse')) {
      const p = state.motion ? (t % 1.8) / 1.8 : 0.55, R = pulseR(map.getZoom());
      map.setPaintProperty('pulse', 'circle-radius', R * (0.35 + 0.9 * p));
      map.setPaintProperty('pulse', 'circle-stroke-opacity', state.motion ? (1 - p) * 0.85 : 0.55);
    }
    for (const h of HAZARDS) if (state.hazards.has(h.id) && h.tick) { const m = h.tick(map, t, dt, state); if (m) huds.push(m); }
  } catch (e) { /* style swapping */ }
  const hud = $('#hud'), txt = huds.join('  ·  ');
  hud.hidden = !txt; if (txt && hud.textContent !== txt) hud.textContent = txt;
}

// ---------- boot ----------
function boot() {
  for (const h of HAZARDS) if (h.defaultOn) state.hazards.add(h.id);
  applyMode(true);
  map = new maplibregl.Map({ container: 'map', style: fullStyle(state.mode), center: [-97, 33], zoom: 1.8, maxPitch: 75, attributionControl: { compact: true } });
  window.__map = map;
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.on('styleimagemissing', e => { if (!map.hasImage(e.id) && window.makeIcon) { const m = makeIcon(e.id); if (m) map.addImage(e.id, m.img, m.opts); } });
  map.on('error', e => console.error('map error', e.error && e.error.message));
  map.once('load', () => { state.ready = true; setTimeout(() => map.flyTo({ ...HOME, duration: 6000, essential: true, curve: 1.6 }), 500); });
  renderHazards();
  setMotion(state.motion);
  setInterval(() => applyMode(false), 60000); // re-check the sun every minute
  requestAnimationFrame(tick);
}
window.addEventListener('DOMContentLoaded', boot);
