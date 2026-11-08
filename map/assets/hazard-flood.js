// Hazard: creek flood. Water spreads only where the ground is low relative to the nearest named creek (HAND tiles).
'use strict';
(() => {
  const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  const COL = {
    night: { deep: 'rgba(16,110,215,0.78)', mid: 'rgba(40,170,255,0.62)', shore: 'rgba(190,245,255,0.95)', clear: 'rgba(60,200,255,0)', wet: '#9ff0ff' },
    day: { deep: 'rgba(8,84,180,0.72)', mid: 'rgba(28,140,232,0.56)', shore: 'rgba(255,255,255,0.92)', clear: 'rgba(28,140,232,0)', wet: '#0a5bd3' },
  };
  const expr = (L, c) => ['interpolate', ['linear'], ['elevation'], -1, c.deep, Math.max(L - 0.7, -0.5), c.mid, L, c.shore, L + 0.22, c.clear, 100, c.clear];
  let mode = 'night', lastL = null, lastF = null;
  HAZARDS.push({
    id: 'flood', label: 'Creek flood', note: 'HAND model', defaultOn: true,
    addTo(s, m, P) {
      mode = m; lastL = lastF = null;
      s.sources.flood = { type: 'raster-dem', tiles: [base + 'tiles/flood/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, minzoom: 12, maxzoom: 14, bounds: FLOOD_BOUNDS,
        attribution: 'Flood: illustrative HAND from USGS 3DEP + OSM creeks' };
      const i = s.layers.findIndex(l => l.id === 'hillshade');
      s.layers.splice(i + 1, 0, { id: 'flood', type: 'color-relief', source: 'flood', minzoom: 11.5, paint: { 'color-relief-color': expr(1.5, COL[m]), 'color-relief-opacity': ['interpolate', ['linear'], ['zoom'], 11.5, 0, 12.3, 1] } });
      const j = s.layers.findIndex(l => l.id === 'hh-shadow');
      s.layers.splice(j, 0, { id: 'hh-wet', type: 'circle', source: 'hh', filter: ['<', ['get', 'hand'], 1.5], paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5.5, 16.5, 13], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': COL[m].wet, 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map',
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 15.2, 0.9, 16, 0] } });
    },
    tick(map, t, dt, st) {
      const peak = st.hazards.has('hurricane') ? 4.2 : st.hazards.has('storm') ? 3.3 : 2.8; // more rain, higher water
      const L = st.motion ? 0.2 + (peak - 0.2) * (0.5 - 0.5 * Math.cos(t * 2 * Math.PI / 24)) : peak * 0.75;
      if (lastL === null || Math.abs(L - lastL) > 0.02) { map.setPaintProperty('flood', 'color-relief-color', expr(L, COL[mode])); lastL = L; }
      const F = Math.round(L * 10) / 10;
      if (F !== lastF) { map.setFilter('hh-wet', ['<', ['get', 'hand'], F]); lastF = F; }
      const n = HH_PTS.features.filter(f => f.properties.hand < L).length;
      return `Creek flood · water ${L.toFixed(1)} m above creek beds · ${n} home${n === 1 ? '' : 's'} in water · illustrative`;
    },
  });
})();
