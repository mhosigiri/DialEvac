// Fits the relief palette to the terrain on screen, anywhere in the US. After each move it reads the
// elevation tiles under the view (the same Terrarium tiles the map draws), takes the 2nd-98th
// percentile height, and restretches the bands. Ocean depths are ignored so coasts don't flatten.
'use strict';
(() => {
  const MIN_RANGE = 30;   // meters; flatter ground than this still gets readable bands
  const MAX_TILES = 12;
  const cache = new Map(); // tile key -> Promise<Float32Array | null>

  const lng2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
  const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  const x2lng = (x, z) => (x / 2 ** z) * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

  function tile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (!cache.has(key)) {
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      cache.set(key, new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const c = document.createElement('canvas'); c.width = c.height = 256;
            const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, 256, 256).data, out = new Float32Array(64 * 64);
            for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) { const p = ((j * 4) * 256 + i * 4) * 4; out[j * 64 + i] = d[p] * 256 + d[p + 1] + d[p + 2] / 256 - 32768; }
            resolve(out);
          } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = TERRARIUM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      }));
    }
    return cache.get(key);
  }

  async function sample(map) {
    const b = map.getBounds(), west = Math.max(b.getWest(), -180), east = Math.min(b.getEast(), 180);
    const south = Math.max(b.getSouth(), -85), north = Math.min(b.getNorth(), 85);
    let z = Math.min(12, Math.max(1, Math.floor(map.getZoom()) - 1));
    while (z > 1 && (lng2x(east, z) - lng2x(west, z) + 1) * (lat2y(south, z) - lat2y(north, z) + 1) > MAX_TILES) z--;
    const jobs = [];
    for (let x = lng2x(west, z); x <= lng2x(east, z); x++) for (let y = lat2y(north, z); y <= lat2y(south, z); y++) jobs.push([x, y, tile(z, x, y)]);
    const values = [];
    for (const [x, y, p] of jobs) {
      const t = await p;
      if (!t) continue;
      for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
        const lng = x2lng(x + (i + 0.5) / 64, z), lat = y2lat(y + (j + 0.5) / 64, z);
        if (lng < west || lng > east || lat < south || lat > north) continue;
        const v = t[j * 64 + i];
        if (v > -5) values.push(v); // below -5 m is sea floor; the water layer covers it
      }
    }
    if (values.length < 50) return null;
    values.sort((a, b) => a - b);
    let lo = values[Math.floor(values.length * 0.02)], hi = values[Math.floor(values.length * 0.98)];
    if (hi - lo < MIN_RANGE) { const mid = (lo + hi) / 2; lo = mid - MIN_RANGE / 2; hi = mid + MIN_RANGE / 2; }
    return { lo: Math.floor(lo), hi: Math.ceil(hi) };
  }

  let seq = 0;
  async function refit(map) {
    const mine = ++seq, r = await sample(map);
    if (!r || mine !== seq) return;
    const span = RELIEF.hi - RELIEF.lo;
    if (Math.abs(r.lo - RELIEF.lo) < span * 0.08 && Math.abs(r.hi - RELIEF.hi) < span * 0.08) return;
    RELIEF = r;
    const P = PAL[state.mode];
    try {
      if (map.getLayer('relief')) map.setPaintProperty('relief', 'color-relief-color', reliefColors(P, false));
      if (map.getLayer('relief-fine')) map.setPaintProperty('relief-fine', 'color-relief-color', reliefColors(P, true));
    } catch { /* style is being swapped; the next build reads RELIEF */ }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const wait = setInterval(() => {
      const map = window.__map;
      if (!map) return;
      clearInterval(wait);
      let timer;
      map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(() => refit(map), 250); });
      map.once('idle', () => refit(map));
    }, 100);
  });
})();
