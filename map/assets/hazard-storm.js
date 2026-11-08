// Hazard: thunderstorm. A simulated weather-radar loop (NWS reflectivity colors) drifting ENE across the city,
// lightning strikes under the strongest cores, and screen-space rain when you are inside the storm.
// Everything is procedural and illustrative: it is not real radar.
'use strict';
const WX = (() => {
  // radar canvas covers ~55 x 50 km around Richardson
  const BOX = { w: -97.06, e: -96.44, n: 33.21, s: 32.75 }, N = 160;
  const cv = document.createElement('canvas'); cv.width = cv.height = N; cv.id = 'radarCanvas'; cv.style.display = 'none'; document.body.appendChild(cv);
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N);
  // smooth value noise for texture
  const noise = (() => { const g = 32, r = []; let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < g * g; i++) r.push(rnd());
    const at = (x, y) => r[((y % g + g) % g) * g + ((x % g + g) % g)], sm = t => t * t * (3 - 2 * t);
    return (x, y) => { let v = 0, a = 0.55, f = 1 / 9; for (let o = 0; o < 3; o++, a *= 0.5, f *= 2) { const X = x * f, Y = y * f, xi = Math.floor(X), yi = Math.floor(Y), u = sm(X - xi), w = sm(Y - yi);
      v += a * ((at(xi, yi) * (1 - u) + at(xi + 1, yi) * u) * (1 - w) + (at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u) * w); } return v / 0.96; }; })();
  // NWS-style reflectivity palette (dBZ -> rgba)
  const PALETTE = [[20, [2, 253, 2]], [25, [1, 197, 1]], [30, [0, 142, 0]], [35, [253, 248, 2]], [40, [229, 188, 0]], [45, [253, 149, 0]], [50, [253, 0, 0]], [55, [212, 0, 0]], [60, [188, 0, 0]], [65, [248, 0, 253]]];
  const color = d => { let c = PALETTE[0][1]; for (const [k, v] of PALETTE) if (d >= k) c = v; return c; };
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // Squall line: a NNE-SSW line of convective cores with a trailing stratiform rain shield, moving east.
  const VX = 2.2, VY = -0.5, PERIOD = (N + 90) / VX; // canvas px/s (y grows southward), ~110 s per pass
  const cores = Array.from({ length: 14 }, (_, i) => ({ y: i * 12 + rnd() * 6 - 4, k: 0.55 + rnd() * 0.5, w: 2.4 + rnd() * 2.2, ph: rnd() * 6.28 }));
  const isolated = Array.from({ length: 4 }, () => ({ dx: 18 + rnd() * 30, y: rnd() * N, k: 0.35 + rnd() * 0.4, r: 2.5 + rnd() * 2.5 }));
  let simT = 0, field = new Float32Array(N * N), maxDbz = 0;
  function step(dt) {
    simT += dt;
    const X0 = ((simT * VX) % (N + 90)) - 45; // leading-edge x at the line's middle
    maxDbz = 0;
    for (let y = 0; y < N; y++) {
      const bow = 10 * Math.exp(-Math.pow((y - 85) / 45, 2)); // bowing segment
      const lx = X0 + bow + (y - 80) * 0.28 + 3 * Math.sin(y / 9 + simT * 0.05);
      let along = 0; // core strength along the line at this y
      for (const c of cores) { const dy = y - c.y + VY * simT * 0; along += c.k * (0.8 + 0.2 * Math.sin(simT * 0.4 + c.ph)) * Math.exp(-Math.pow(dy / 5.5, 2)); }
      along = Math.min(1.25, along);
      for (let x = 0; x < N; x++) {
        const dx = x - lx;
        let v = 0;
        if (dx > -10 && dx < 18) v += along * Math.exp(-Math.pow((dx - 3) / 5.5, 2));          // convective line
        if (dx < 4 && dx > -80) v += 0.42 * Math.exp(dx / 32) * (dx < -2 ? 1 : (4 - dx) / 6); // trailing stratiform shield
        if (dx < -7 && dx > -18) v *= 0.8;                                                    // transition zone (weaker echo)
        for (const c of isolated) { const ix = lx + c.dx, ddx = x - ix, ddy = y - c.y; v += c.k * Math.exp(-(ddx * ddx + ddy * ddy) / (c.r * c.r * 2)); }
        const n = noise(x * 1.7 - simT * VX * 1.7, y * 1.7);
        const d = Math.min(66, 60 * Math.pow(Math.max(0, v), 0.75) * (0.5 + 0.75 * n));
        field[y * N + x] = d; if (d > maxDbz) maxDbz = d;
      }
    }
  }
  function paint(alpha) {
    const D = img.data;
    for (let i = 0; i < N * N; i++) {
      const d = field[i], o = i * 4;
      if (d < 18) { D[o] = D[o + 1] = D[o + 2] = D[o + 3] = 0; continue; }
      const [r, g, b] = color(d), a = 255 * alpha * Math.min(1, (d - 18) / 6) * (0.75 + 0.25 * Math.min(1, (d - 20) / 40)), k = a / 255; // premultiplied (see hurricane)
      D[o] = r * k; D[o + 1] = g * k; D[o + 2] = b * k; D[o + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
  }
  const toLngLat = (x, y) => [BOX.w + (x / N) * (BOX.e - BOX.w), BOX.n - (y / N) * (BOX.n - BOX.s)];
  const toXY = ([lng, lat]) => [(lng - BOX.w) / (BOX.e - BOX.w) * N, (BOX.n - lat) / (BOX.n - BOX.s) * N];
  const dbzAt = ll => { const [x, y] = toXY(ll).map(Math.round); return x < 0 || y < 0 || x >= N || y >= N ? 0 : field[y * N + x]; };
  // lightning: strikes under strong cores
  const strikes = []; let strikeClock = 0, strikesTotal = [];
  function lightning(dt, now) {
    strikeClock -= dt;
    if (strikeClock <= 0) {
      strikeClock = 0.35 + rnd() * 1.0;
      for (let tries = 0; tries < 40; tries++) {
        const x = Math.floor(rnd() * N), y = Math.floor(rnd() * N);
        if (field[y * N + x] > 44) { strikes.push({ ll: toLngLat(x + rnd(), y + rnd()), t0: now }); strikesTotal.push(now); break; }
      }
    }
    while (strikes.length && now - strikes[0].t0 > 1.6) strikes.shift();
    while (strikesTotal.length && now - strikesTotal[0] > 60) strikesTotal.shift();
  }
  const strikeFC = now => fc(strikes.map(s => ({ type: 'Feature', properties: { a: Math.max(0, 1 - (now - s.t0) / 1.6) }, geometry: { type: 'Point', coordinates: s.ll } })));
  // screen rain
  const rainCv = document.getElementById('rain'), rctx = rainCv.getContext('2d'); let drops = [];
  function rain(map, intensity, motion, dark) {
    const W = rainCv.clientWidth, H = rainCv.clientHeight;
    if (rainCv.width !== W) { rainCv.width = W; rainCv.height = H; }
    rctx.clearRect(0, 0, W, H);
    if (!motion || intensity <= 0.02) { drops = []; return; }
    const want = Math.round(500 * intensity);
    while (drops.length < want) drops.push({ x: Math.random() * W, y: Math.random() * H, v: 900 + Math.random() * 700, l: 10 + Math.random() * 16 });
    drops.length = Math.min(drops.length, want);
    rctx.strokeStyle = dark ? 'rgba(200,235,255,0.28)' : 'rgba(40,80,110,0.22)'; rctx.lineWidth = 1; rctx.beginPath();
    for (const d of drops) { d.y += d.v / 60; d.x += d.v / 60 * 0.18; if (d.y > H) { d.y = -20; d.x = Math.random() * W; } rctx.moveTo(d.x, d.y); rctx.lineTo(d.x - d.l * 0.18, d.y - d.l); }
    rctx.stroke();
  }
  function clearRain() { rctx.clearRect(0, 0, rainCv.width, rainCv.height); drops = []; }
  // bolt icon for strikes
  window.makeIcon = window.makeIcon || (id => {
    if (id !== 'bolt') return null;
    const c = document.createElement('canvas'); c.width = 36; c.height = 48; const x = c.getContext('2d');
    x.beginPath(); [[21, 2], [6, 27], [17, 27], [12, 46], [31, 18], [19, 18], [26, 2]].forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath();
    x.fillStyle = '#fff7b0'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#2a2100'; x.stroke();
    const d = x.getImageData(0, 0, 36, 48); return { img: { width: 36, height: 48, data: new Uint8Array(d.data.buffer) }, opts: { pixelRatio: 2 } };
  });
  return { BOX, cv, step, paint, dbzAt, lightning, strikeFC, strikesTotal: () => strikesTotal.length, maxDbz: () => maxDbz, rain, clearRain, coords: () => [[BOX.w, BOX.n], [BOX.e, BOX.n], [BOX.e, BOX.s], [BOX.w, BOX.s]] };
})();

(() => {
  let mode = 'night', acc = 0, simAcc = 0;
  WX.step(0); WX.paint(0.7);
  HAZARDS.push({
    id: 'storm', label: 'Thunderstorm', note: 'radar sim',
    addTo(s, m) {
      mode = m;
      s.sources.radar = { type: 'canvas', canvas: 'radarCanvas', coordinates: WX.coords(), animate: true };
      s.sources.strikes = { type: 'geojson', data: fc([]) };
      s.sources.wxdim = s.sources.wxdim || { type: 'geojson', data: fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } }]) };
      if (!s.layers.some(l => l.id === 'wx-dim')) s.layers.splice(s.layers.findIndex(l => l.id === 'hillshade') + 2, 0, { id: 'wx-dim', type: 'fill', source: 'wxdim', paint: { 'fill-color': m === 'day' ? '#eef3f1' : '#02141a', 'fill-opacity': m === 'day' ? 0.45 : 0.42 } });
      s.layers.splice(s.layers.findIndex(l => l.id === 'hh-shadow'), 0, { id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.85, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } });
      s.layers.push(
        { id: 'strike-glow', type: 'circle', source: 'strikes', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 15, 60], 'circle-color': '#fff3b0', 'circle-blur': 1, 'circle-opacity': ['*', 0.55, ['get', 'a']], 'circle-pitch-alignment': 'map' } },
        { id: 'strike-ring', type: 'circle', source: 'strikes', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'a'], 0, 34, 1, 6], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#fff3b0', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': ['get', 'a'], 'circle-pitch-alignment': 'map' } },
        { id: 'strike-bolt', type: 'symbol', source: 'strikes', layout: { 'icon-image': 'bolt', 'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 15, 1], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-anchor': 'bottom' }, paint: { 'icon-opacity': ['get', 'a'] } });
    },
    toggled(map, on) { if (!on) WX.clearRain(); else if (map.getZoom() < 9) map.flyTo({ center: [-96.75, 32.975], zoom: 10.6, pitch: 30, bearing: -10, duration: 2500 }); },
    tick(map, t, dt, st) {
      if (st.motion) { simAcc += dt; acc += dt; if (acc > 0.1) { WX.step(acc); WX.paint(mode === 'day' ? 0.75 : 0.8); acc = 0; } WX.lightning(dt, t); }
      const src = map.getSource('strikes'); if (src) src.setData(WX.strikeFC(t));
      const c = map.getCenter().toArray(), dbz = WX.dbzAt(c), inside = map.getZoom() > 10.5 ? Math.max(0, Math.min(1, (dbz - 18) / 35)) : 0;
      WX.rain(map, Math.max(inside, WX.extraRain || 0), st.motion, mode === 'night');
      return `Thunderstorm · max ${Math.round(WX.maxDbz())} dBZ · ${WX.strikesTotal()} strikes/min · ${dbz > 18 ? 'raining here' : 'dry here'} · simulated radar`;
    },
  });
})();
