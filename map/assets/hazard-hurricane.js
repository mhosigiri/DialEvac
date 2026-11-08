// Hazard: hurricane. A procedural rotating storm over the Gulf (visible-satellite look by day, enhanced-infrared by night),
// with a past track, forecast track, cone of uncertainty and wind-radius rings. Its outer rain bands reach Richardson.
// Entirely illustrative: not a forecast.
'use strict';
const HURR = (() => {
  const BOX = { w: -102, e: -88, n: 36.5, s: 22.5 }, N = 250; // NOT a power of two: POT canvases get stale mipmaps in MapLibre (texture looks flat at low zoom)
  const EYE = [-95.3, 29.3];
  const cv = document.createElement('canvas'); cv.width = cv.height = N; cv.id = 'hurricaneCanvas'; cv.style.display = 'none'; document.body.appendChild(cv);
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), dens = new Float32Array(N * N);
  const ex = (EYE[0] - BOX.w) / (BOX.e - BOX.w) * N, ey = (BOX.n - EYE[1]) / (BOX.n - BOX.s) * N;
  const ASPECT = 1 / Math.cos(29.5 * Math.PI / 180); // canvas is equirectangular; stretch y so the storm looks round on the map
  const RMAX = 118; // outer band radius in canvas px (~650 km)
  const vn = (() => { const g = 64, r = new Float32Array(g * g); let s = 11; for (let i = 0; i < g * g; i++) r[i] = (s = (s * 16807) % 2147483647) / 2147483647;
    const at = (x, y) => r[((y & (g - 1)) * g) + (x & (g - 1))], sm = t => t * t * (3 - 2 * t);
    return (x, y) => { let v = 0, a = 0.6, f = 0.12; for (let o = 0; o < 3; o++, a *= 0.5, f *= 2.1) { const X = x * f + 100, Y = y * f + 100, xi = Math.floor(X), yi = Math.floor(Y), u = sm(X - xi), w = sm(Y - yi);
      v += a * ((at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - w) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * w); } return v / 1.05; }; })();
  const IR = [[0.0, [60, 70, 90, 0]], [0.2, [118, 128, 150, 60]], [0.42, [196, 202, 214, 160]], [0.6, [236, 239, 243, 210]], [0.72, [130, 205, 255, 222]], [0.82, [50, 195, 125, 232]], [0.9, [250, 222, 70, 240]], [0.96, [255, 110, 45, 245]], [1.0, [255, 50, 110, 250]]]; // enhanced IR: gray-white, color only for the coldest tops
  const irColor = v => { for (let i = 1; i < IR.length; i++) if (v <= IR[i][0]) { const [a, A] = IR[i - 1], [b, B] = IR[i], t = (v - a) / (b - a); return A.map((x, j) => x + (B[j] - x) * t); } return IR.at(-1)[1]; };
  let rot = 0;
  function step(dt) {
    rot += dt * 0.12; // radians/s of the cloud pattern (sped up for illustration)
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - ex, dy = (y - ey) * ASPECT, r = Math.hypot(dx, dy) / RMAX, i = y * N + x;
      if (r > 1.25) { dens[i] = 0; continue; }
      const th = Math.atan2(-dy, dx); // math angle, counter-clockwise
      const rx = (c * dx - s * -dy), ry = (s * dx + c * -dy); // rotate sample space with the storm (CCW)
      const n = vn(rx, ry);
      const lr = Math.log(Math.max(r, 0.02)), ph = th - rot;
      const arm2 = 0.5 + 0.5 * Math.cos(2 * ph - 6.2 * lr + n * 3.4), arm3 = 0.5 + 0.5 * Math.cos(3 * ph - 7.4 * lr + n * 4.1 + 1.3);
      const spiral = Math.max(Math.pow(arm2, 2.4), 0.7 * Math.pow(arm3, 3));
      const bands = spiral * Math.max(0, 1 - Math.pow(r / 1.05, 2.5)) * (0.35 + 0.75 * n) * (0.65 + 0.35 * Math.min(1, 0.3 / r));
      const cdo = Math.exp(-Math.pow(r / 0.27, 2)) * (0.62 + 0.4 * n);
      const wall = Math.exp(-Math.pow((r - 0.06) / 0.028, 2));
      const eye = r < 0.035 ? Math.pow(r / 0.035, 3) : 1;
      dens[i] = Math.min(1, (Math.max(bands, cdo) + 0.42 * wall) * eye);
    }
  }
  function paint(mode) {
    const D = img.data;
    for (let i = 0; i < N * N; i++) {
      const v = dens[i], o = i * 4;
      // MapLibre blends canvas textures as premultiplied alpha, so store color * alpha
      if (v < 0.04) { D[o] = D[o + 1] = D[o + 2] = D[o + 3] = 0; continue; }
      let r, g, b, a;
      if (mode === 'day') { const w = 236 + 19 * v; [r, g, b] = [w - 6, w - 3, w]; a = 255 * Math.min(0.93, v * 1.15); }
      else { const c = irColor(v); [r, g, b] = c; a = c[3] * Math.min(1, v * 4); }
      const k = a / 255; D[o] = r * k; D[o + 1] = g * k; D[o + 2] = b * k; D[o + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
  }
  const densityAt = ([lng, lat]) => { const x = Math.round((lng - BOX.w) / (BOX.e - BOX.w) * N), y = Math.round((BOX.n - lat) / (BOX.n - BOX.s) * N); return x < 0 || y < 0 || x >= N || y >= N ? 0 : dens[y * N + x]; };
  // track, cone, wind radii (illustrative)
  const past = [[-88.9, 23.6], [-90.3, 24.9], [-91.7, 26.1], [-93.2, 27.4], [-94.4, 28.4], EYE];
  const fut = [EYE, [-95.95, 30.55], [-96.5, 31.8], [-96.75, 33.0], [-96.6, 34.3]];
  const futLbl = ['NOW · CAT 3 · 115 mph', '+12 h · CAT 1', '+24 h · TROPICAL STORM', '+36 h · TS · DALLAS–RICHARDSON', '+48 h · DEPRESSION'];
  const circle = (c, rKm, n = 72) => Array.from({ length: n + 1 }, (_, i) => { const a = i / n * 2 * Math.PI; return [c[0] + rKm / (111.32 * Math.cos(c[1] * Math.PI / 180)) * Math.cos(a), c[1] + rKm / 110.57 * Math.sin(a)]; });
  function cone() { // union of circles along the forecast, approximated by a hull of left/right offsets
    const rad = [20, 60, 95, 130, 170], L = [], R = [];
    for (let i = 0; i < fut.length; i++) {
      const a = fut[Math.max(0, i - 1)], b = fut[Math.min(fut.length - 1, i + 1)], dx = (b[0] - a[0]) * Math.cos(fut[i][1] * Math.PI / 180), dy = b[1] - a[1], len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len, kx = rad[i] / (111.32 * Math.cos(fut[i][1] * Math.PI / 180)), ky = rad[i] / 110.57;
      L.push([fut[i][0] + nx * kx, fut[i][1] + ny * ky]); R.push([fut[i][0] - nx * kx, fut[i][1] - ny * ky]);
    }
    const tip = circle(fut.at(-1), rad.at(-1), 24).filter(p => p[1] >= fut.at(-1)[1] - 0.2);
    return [...L, ...tip.reverse(), ...R.reverse(), L[0]];
  }
  const GEO = fc([
    { type: 'Feature', properties: { k: 'cone' }, geometry: { type: 'Polygon', coordinates: [cone()] } },
    { type: 'Feature', properties: { k: 'past' }, geometry: { type: 'LineString', coordinates: past } },
    { type: 'Feature', properties: { k: 'fut' }, geometry: { type: 'LineString', coordinates: fut } },
    { type: 'Feature', properties: { k: 'ts34', label: 'TROPICAL-STORM WINDS' }, geometry: { type: 'LineString', coordinates: circle(EYE, 280) } },
    { type: 'Feature', properties: { k: 'h64', label: 'HURRICANE WINDS' }, geometry: { type: 'LineString', coordinates: circle(EYE, 95) } },
    ...past.slice(0, -1).map(p => ({ type: 'Feature', properties: { k: 'pt', past: 1 }, geometry: { type: 'Point', coordinates: p } })),
    ...fut.map((p, i) => ({ type: 'Feature', properties: { k: 'pt', past: 0, label: futLbl[i], now: i === 0 ? 1 : 0 }, geometry: { type: 'Point', coordinates: p } })),
  ]);
  const coords = () => [[BOX.w, BOX.n], [BOX.e, BOX.n], [BOX.e, BOX.s], [BOX.w, BOX.s]];
  return { cv, step, paint, densityAt, GEO, EYE, coords };
})();

(() => {
  let mode = 'night', acc = 0;
  HURR.step(0); HURR.paint('night');
  const prevIcon = window.makeIcon;
  window.makeIcon = id => {
    if (id !== 'hurricane') return prevIcon ? prevIcon(id) : null;
    const S = 56, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    x.translate(S / 2, S / 2); x.fillStyle = '#ff2d55'; x.strokeStyle = '#ffffff'; x.lineWidth = 3;
    for (const k of [0, Math.PI]) { x.save(); x.rotate(k); x.beginPath(); x.moveTo(0, -6); x.quadraticCurveTo(14, -24, -4, -26); x.quadraticCurveTo(8, -16, -6, -6); x.closePath(); x.fill(); x.stroke(); x.restore(); }
    x.beginPath(); x.arc(0, 0, 9, 0, 7); x.fill(); x.stroke(); x.beginPath(); x.arc(0, 0, 3.5, 0, 7); x.fillStyle = '#ffffff'; x.fill();
    const d = x.getImageData(0, 0, S, S); return { img: { width: S, height: S, data: new Uint8Array(d.data.buffer) }, opts: { pixelRatio: 2 } };
  };
  HAZARDS.push({
    id: 'hurricane', label: 'Hurricane', note: 'Gulf landfall',
    addTo(s, m) {
      mode = m; HURR.paint(m);
      const ink = m === 'day' ? '#14302f' : '#ffffff', halo = m === 'day' ? 'rgba(255,253,245,.92)' : 'rgba(4,20,26,.9)';
      s.sources.hurricane = { type: 'canvas', canvas: 'hurricaneCanvas', coordinates: HURR.coords(), animate: true };
      s.sources.track = { type: 'geojson', data: HURR.GEO };
      s.sources.wxdim = s.sources.wxdim || { type: 'geojson', data: fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } }]) };
      if (!s.layers.some(l => l.id === 'wx-dim')) s.layers.splice(s.layers.findIndex(l => l.id === 'hillshade') + 2, 0, { id: 'wx-dim', type: 'fill', source: 'wxdim', paint: { 'fill-color': m === 'day' ? '#eef3f1' : '#02141a', 'fill-opacity': m === 'day' ? 0.45 : 0.42 } });
      s.layers.splice(s.layers.findIndex(l => l.id === 'hh-shadow'), 0,
        { id: 'cone', type: 'fill', source: 'track', filter: ['==', ['get', 'k'], 'cone'], paint: { 'fill-color': m === 'day' ? '#ffffff' : '#ffffff', 'fill-opacity': m === 'day' ? 0.35 : 0.1 } },
        { id: 'cone-edge', type: 'line', source: 'track', filter: ['==', ['get', 'k'], 'cone'], paint: { 'line-color': ink, 'line-opacity': 0.55, 'line-width': 1.2, 'line-dasharray': [2, 2] } },
        { id: 'hurricane', type: 'raster', source: 'hurricane', paint: { 'raster-opacity': 0.92, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
        { id: 'wind-rings', type: 'line', source: 'track', filter: ['in', ['get', 'k'], ['literal', ['ts34', 'h64']]], paint: { 'line-color': ['match', ['get', 'k'], 'h64', '#ff2d55', '#ffb000'], 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': [3, 2] } },
        { id: 'track-past', type: 'line', source: 'track', filter: ['==', ['get', 'k'], 'past'], paint: { 'line-color': ink, 'line-width': 2, 'line-opacity': 0.8 } },
        { id: 'track-fut', type: 'line', source: 'track', filter: ['==', ['get', 'k'], 'fut'], paint: { 'line-color': ink, 'line-width': 2.4, 'line-dasharray': [1.5, 1.2] } });
      s.layers.push(
        { id: 'track-pt', type: 'circle', source: 'track', filter: ['all', ['==', ['get', 'k'], 'pt'], ['!=', ['get', 'now'], 1]], paint: { 'circle-radius': ['case', ['==', ['get', 'past'], 1], 3, 5], 'circle-color': ['case', ['==', ['get', 'past'], 1], ink, '#ffb000'], 'circle-stroke-color': halo, 'circle-stroke-width': 1.5 } },
        { id: 'eye-icon', type: 'symbol', source: 'track', filter: ['==', ['get', 'now'], 1], layout: { 'icon-image': 'hurricane', 'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.1], 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map', 'icon-rotate': 0 } },
        { id: 'track-label', type: 'symbol', source: 'track', filter: ['all', ['==', ['get', 'k'], 'pt'], ['has', 'label']], minzoom: 3.5, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-letter-spacing': 0.06, 'text-anchor': 'left', 'text-offset': [1.2, 0], 'text-allow-overlap': false }, paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6 } },
        { id: 'ring-label', type: 'symbol', source: 'track', filter: ['in', ['get', 'k'], ['literal', ['ts34', 'h64']]], minzoom: 4.5, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-letter-spacing': 0.12, 'symbol-spacing': 500 }, paint: { 'text-color': ['match', ['get', 'k'], 'h64', '#ff6b86', '#ffc54d'], 'text-halo-color': halo, 'text-halo-width': 1.5 } });
    },
    toggled(map, on) {
      if (on) map.flyTo({ center: [-95.6, 30.9], zoom: 5.15, pitch: 0, bearing: 0, duration: 3500, essential: true });
      else if (map.getZoom() < 9) map.flyTo({ ...HOME, duration: 3000 });
    },
    tick(map, t, dt, st) {
      if (st.motion) { acc += dt; if (acc > 0.12) { HURR.step(acc); HURR.paint(mode); acc = 0; } if (map.getLayer('eye-icon')) map.setLayoutProperty('eye-icon', 'icon-rotate', (-t * 40) % 360); }
      const c = map.getCenter().toArray(), d = HURR.densityAt(c), rainHere = map.getZoom() > 9 ? Math.max(0, Math.min(1, (d - 0.15) / 0.5)) : 0;
      if (!st.hazards.has('storm')) WX.rain(map, rainHere, st.motion, mode === 'night'); else WX.extraRain = rainHere;
      return `Hurricane · CAT 3 landfall near Galveston · forecast reaches Richardson as a tropical storm in ~36 h · ${rainHere > 0.05 ? 'rain bands here' : 'no rain here'} · illustrative, not a forecast`;
    },
  });
})();
