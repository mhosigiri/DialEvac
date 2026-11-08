// Haven Floodplain map: one style, two moods (day / night), compiled to a MapLibre style JSON.
// Base = OpenFreeMap vector tiles recolored; relief = USGS 3DEP elevation (Terrarium tiles).
'use strict';

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TERRARIUM = { type: 'raster-dem', tiles: [TERRARIUM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15,
  attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> (USGS 3DEP)' };
const HOME = { center: [-98.6, 39.2], zoom: 3.75, pitch: 0, bearing: 0 }; // the contiguous US
// The synthetic Richardson households and footprints. Real household locations are private and stay
// off the public map; this switch keeps their styling for a later dispatcher-only view.
const SHOW_DEMO_HOUSEHOLDS = false;

// ---------- data ----------
if (typeof fc === 'undefined') var fc = features => ({ type: 'FeatureCollection', features });
const FP = SHOW_DEMO_HOUSEHOLDS && typeof HOUSE_FP !== 'undefined' ? HOUSE_FP.features : [];
// Status follows the flood: homes in the low creek zone (HAND <= 2.5 m) are urgent; resolved homes within 4 m become unreached again.
function floodStatus(p, hand) { if (hand <= 2.5) return 'urgent'; if (hand <= 4 && p.status === 'resolved') return 'unreached'; return p.status; }
for (const f of FP) { const hand = (typeof FLOOD_HAND !== 'undefined' ? FLOOD_HAND : {})[f.properties.id] ?? 60; f.properties.hand = hand; f.properties.status = floodStatus(f.properties, hand); }
const HH_PTS = fc(FP.map(f => ({ type: 'Feature', properties: { ...f.properties, label: `${f.properties.id} · ${f.properties.people} ppl` }, geometry: { type: 'Point', coordinates: [f.properties.lng, f.properties.lat] } })));
const FP_FC = fc(FP);
function grow(f, k) { const { lng, lat } = f.properties; return { ...f, geometry: { type: 'Polygon', coordinates: [f.geometry.coordinates[0].map(([x, y]) => [lng + (x - lng) * k, lat + (y - lat) * k])] } }; }
const FP_BIG = fc(FP.map(f => grow(f, 1.12))); // slightly larger than the OSM building in the tiles, so the two don't z-fight

// on-the-fly contour lines from the same DEM (maplibre-contour, BSD-3); optional if the CDN script failed
let CONTOUR_URL = null;
if (window.mlcontour) {
  const dem = new mlcontour.DemSource({ url: TERRARIUM_URL, encoding: 'terrarium', maxzoom: 14, worker: true, cacheSize: 120 });
  dem.setupMaplibre(maplibregl);
  CONTOUR_URL = dem.contourProtocolUrl({ thresholds: { 11: [10, 50], 12: [5, 25], 13: [2, 10], 14: [1, 5], 15: [1, 5] }, contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level', extent: 4096, buffer: 1 });
}
const zf = (z0, z1, a, b) => ['interpolate', ['linear'], ['zoom'], z0, a, z1, b]; // zoom fade helper

// ---------- palettes ----------
const PAL = {
  night: {
    name: 'Night', bg: '#0a3a45', water: '#5fd6f5', waterOpacity: 0.85, waterway: '#7fe3ff', building: '#ffffff', buildingOpacity: 0.12,
    road: '#ffffff', roadOpacity: 0.16, label: '#f4f1de', waterLabel: '#bff1ff', halo: '#073039',
    relief: [[160, '#022630'], [172, '#06505e'], [182, '#0f7d7a'], [190, '#3aa48a'], [198, '#8cc591'], [206, '#d5dca3'], [214, '#f3e3b0'], [226, '#fff4dc']], rim: 0.72,
    hill: { shadow: 'rgba(1,20,26,0.85)', highlight: 'rgba(255,250,230,0.18)', exaggeration: 0.55 },
    glow: '#7fe3ff', glowOpacity: 0.55, hhShadow: '#021a20', hhStroke: '#ffffff',
    status: { urgent: '#ff3358', unreached: '#ffb000', assigned: '#8a5cff', resolved: '#e8f1ee' },
    sky: { 'sky-color': '#041c24', 'horizon-color': '#1d6b70', 'fog-color': '#0a3a45', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5 },
    ui: { bg: 'rgba(6,36,44,.82)', ink: '#f4f1de', sub: '#9cc6c2', line: 'rgba(160,230,230,.16)', accent: '#7fe3ff' },
    fx: 'radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 55%,rgba(2,20,26,.6) 100%)',
    contour: 'rgba(235,250,235,0.42)', contourMajor: 'rgba(245,255,240,0.7)', contourLabel: '#e9f6ee',
    bldg: ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#0f5560', 25, '#1b6c74', 80, '#2f8a8c'], bldgOpacity: 0.88,
    light: { anchor: 'map', color: '#d6f4ff', intensity: 0.4, position: [1.3, 210, 40] },
  },
  day: {
    name: 'Day', bg: '#d9ece3', water: '#2fa8dc', waterOpacity: 0.9, waterway: '#2fa8dc', building: '#0b3a45', buildingOpacity: 0.09,
    road: '#ffffff', roadOpacity: 0.9, label: '#16353a', waterLabel: '#0f6d94', halo: 'rgba(255,253,245,0.92)',
    relief: [[160, '#4e9f9c'], [172, '#79bdb0'], [182, '#a3d2bd'], [190, '#c6e2c4'], [198, '#e1ecc9'], [206, '#f0efd2'], [214, '#f7f0db'], [226, '#fffaf0']], rim: 0.88,
    hill: { shadow: 'rgba(20,60,70,0.42)', highlight: 'rgba(255,255,255,0.55)', exaggeration: 0.5 },
    glow: '#2fa8dc', glowOpacity: 0.25, hhShadow: '#0b3a45', hhStroke: '#ffffff',
    status: { urgent: '#e0173a', unreached: '#e38a00', assigned: '#5a31d6', resolved: '#7d8f8c' },
    sky: { 'sky-color': '#a9dcf2', 'horizon-color': '#ffffff', 'fog-color': '#d9ece3', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.5 },
    ui: { bg: 'rgba(255,253,247,.88)', ink: '#14302f', sub: '#4d6b68', line: 'rgba(10,58,69,.12)', accent: '#0f7d7a' },
    fx: 'radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 62%,rgba(20,60,70,.16) 100%)',
    contour: 'rgba(16,70,72,0.32)', contourMajor: 'rgba(16,70,72,0.6)', contourLabel: '#1d4d4f',
    bldg: ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#f6f3ea', 40, '#fbfaf6'], bldgOpacity: 0.92,
    light: { anchor: 'map', color: '#ffffff', intensity: 0.42, position: [1.3, 210, 40] },
  },
};

// ---------- helpers ----------
function scaleW(w, k) {
  if (typeof w === 'number') return w * k;
  if (Array.isArray(w) && w[0] === 'interpolate') return w.map((v, i) => (i > 3 && i % 2 === 0 && typeof v === 'number' ? v * k : v));
  return w;
}
const statusExpr = c => ['match', ['get', 'status'], 'urgent', c.urgent, 'unreached', c.unreached, 'assigned', c.assigned, c.resolved];
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function ramp(stops, v) {
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = Math.max(0, (v - a) / (b - a)), A = hex2rgb(ca), B = hex2rgb(cb);
    return `rgb(${A.map((x, j) => Math.round(x + (B[j] - x) * t)).join(',')})`;
  }
  return stops.at(-1)[1];
}
// terraced hypsometric tint: flat color per band + darker rim at the band's top edge (reads as a contour)
// k scales the fixed offsets (designed for a 68 m range) when the palette is stretched to other terrain.
function bands(stops, from, to, step, rimK, rimW, k = 1) {
  const e = ['interpolate', ['linear'], ['elevation'], from - 50 * k, ramp(stops, from)];
  const dark = c => c.replace(/\d+/g, n => Math.round(n * rimK));
  for (let i = 0, v = from; i < Math.round((to - from) / step); i++, v = from + i * step) {
    const c = ramp(stops, v + step / 2);
    if (rimW > 0) e.push(v, c, v + step - rimW * k - 0.15 * k, c, v + step - rimW * k, dark(c), v + step - 0.04 * k, dark(c));
    else e.push(v, c, v + step - 0.08 * k, c);
  }
  e.push(to + 100 * k, ramp(stops, to));
  return e;
}
// The palettes were drawn for Richardson's 160-228 m. RELIEF holds the elevation range on screen
// (assets/relief.js samples it); the palette and band count stretch to fit, so any US terrain reads the same way.
const RELIEF_BASE = [160, 228];
let RELIEF = { lo: 160, hi: 228 };
function reliefColors(P, fine) {
  const { lo, hi } = RELIEF, k = (hi - lo) / (RELIEF_BASE[1] - RELIEF_BASE[0]);
  const stops = P.relief.map(([v, c]) => [lo + (v - RELIEF_BASE[0]) * k, c]);
  return fine ? bands(stops, lo, hi, (hi - lo) / 68, 1, 0, k) : bands(stops, lo, hi, (hi - lo) / 17, P.rim, 0.3, k);
}

// ---------- base recolor ----------
function recolor(s, P) {
  const hide = [/landuse_residential/, /^park$/, /landcover/, /aeroway-area/, /name-path/, /dashline/, /road_area_pier/];
  s.layers = s.layers.filter(l => !hide.some(rx => rx.test(l.id)) && !(l.type === 'symbol' && !(l.layout || {})['text-field']));
  for (const l of s.layers) {
    const id = l.id, p = (l.paint = l.paint || {}), lay = (l.layout = l.layout || {});
    if (l.type === 'raster') p['raster-opacity'] = 0;
    else if (l.type === 'background') p['background-color'] = P.bg;
    else if (l.type === 'fill') {
      p['fill-color'] = id === 'water' ? P.water : id === 'building' ? P.building : P.bg; delete p['fill-pattern'];
      if (id === 'water') p['fill-opacity'] = P.waterOpacity;
      if (id === 'building') { p['fill-opacity'] = P.buildingOpacity; p['fill-outline-color'] = P.building; }
    } else if (l.type === 'line') {
      if (id === 'waterway') { p['line-color'] = P.waterway; p['line-width'] = scaleW(p['line-width'] ?? 1, 1.6); }
      else { p['line-color'] = /casing/.test(id) ? 'rgba(0,0,0,0)' : P.road; p['line-opacity'] = P.roadOpacity; }
    } else if (l.type === 'symbol') {
      delete lay['icon-image'];
      const water = /water/.test(id);
      p['text-color'] = water ? P.waterLabel : P.label; p['text-halo-color'] = P.halo; p['text-halo-width'] = 1.4; p['text-halo-blur'] = 0.3;
    }
  }
  return s;
}
const insertAfter = (s, id, ...layers) => { const i = s.layers.findIndex(l => l.id === id); s.layers.splice(i + 1, 0, ...layers); };
const beforeSymbols = (s, ...layers) => { const i = s.layers.findIndex(l => l.type === 'symbol'); s.layers.splice(i === -1 ? s.layers.length : i, 0, ...layers); };

// ---------- compile ----------
function buildStyle(mode) {
  const P = PAL[mode], c = P.status;
  const s = recolor(structuredClone(BASE_STYLE), P);
  s.projection = { type: 'globe' };
  s.transition = { duration: 900, delay: 0 };
  s.sky = Object.assign({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0] }, P.sky);
  s.sources.openmaptiles.attribution = (s.sources.openmaptiles.attribution || '') + ' · Footprints © OpenStreetMap contributors';
  s.sources.demRelief = TERRARIUM; s.sources.demHill = TERRARIUM;
  s.sources.hh = { type: 'geojson', data: HH_PTS }; // empty unless SHOW_DEMO_HOUSEHOLDS
  if (SHOW_DEMO_HOUSEHOLDS) { s.sources.fp = { type: 'geojson', data: FP_FC }; s.sources.fpBig = { type: 'geojson', data: FP_BIG }; }
  s.light = P.light;
  if (CONTOUR_URL) s.sources.contours = { type: 'vector', tiles: [CONTOUR_URL], maxzoom: 15 };
  insertAfter(s, 'background',
    { id: 'relief', type: 'color-relief', source: 'demRelief', paint: { 'color-relief-color': reliefColors(P, false), 'color-relief-opacity': zf(14, 15, 1, 0) } },
    { id: 'relief-fine', type: 'color-relief', source: 'demRelief', minzoom: 13.8, paint: { 'color-relief-color': reliefColors(P, true), 'color-relief-opacity': zf(14, 15, 0, 1) } },
    { id: 'hillshade', type: 'hillshade', source: 'demHill', paint: { 'hillshade-method': 'multidirectional', 'hillshade-exaggeration': P.hill.exaggeration, 'hillshade-shadow-color': P.hill.shadow, 'hillshade-highlight-color': P.hill.highlight } });
  const ww = s.layers.find(l => l.id === 'waterway');
  if (ww) { const g = structuredClone(ww); g.id = 'waterway-glow'; g.paint = { 'line-color': P.glow, 'line-width': scaleW(ww.paint['line-width'], 3.2), 'line-blur': scaleW(ww.paint['line-width'], 2.6), 'line-opacity': P.glowOpacity }; s.layers.splice(s.layers.indexOf(ww), 0, g); }
  if (CONTOUR_URL) beforeSymbols(s,
    { id: 'contour', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 12.5, paint: {
      'line-color': ['match', ['get', 'level'], 1, P.contourMajor, P.contour], 'line-width': ['match', ['get', 'level'], 1, 1.1, 0.55], 'line-opacity': zf(12.5, 13.5, 0, 1) } });
  beforeSymbols(s,
    { id: 'bldg-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14.8, paint: {
      'fill-extrusion-color': P.bldg, 'fill-extrusion-opacity': P.bldgOpacity, 'fill-extrusion-vertical-gradient': true,
      'fill-extrusion-height': zf(14.8, 15.8, 0, ['coalesce', ['get', 'render_height'], 6]), 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } },
    { id: 'fp-3d', type: 'fill-extrusion', source: 'fpBig', minzoom: 14.8, paint: {
      'fill-extrusion-color': statusExpr(c), 'fill-extrusion-opacity': 0.95, 'fill-extrusion-vertical-gradient': true,
      'fill-extrusion-height': zf(14.8, 15.8, 0, ['match', ['get', 'status'], 'urgent', 12, 'unreached', 10.5, 'assigned', 9.5, 8]) } });
  beforeSymbols(s,
    { id: 'pulse', type: 'circle', source: 'hh', filter: ['==', ['get', 'status'], 'urgent'], paint: { 'circle-radius': 10, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': c.urgent, 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.6, 'circle-pitch-alignment': 'map', 'circle-radius-transition': { duration: 0 }, 'circle-stroke-opacity-transition': { duration: 0 } } });
  s.layers.push(
    ...(CONTOUR_URL ? [{ id: 'contour-label', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 13, filter: ['>', ['get', 'level'], 0], layout: {
      'symbol-placement': 'line', 'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'symbol-spacing': 360 },
      paint: { 'text-color': P.contourLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.4 } }] : []),
    { id: 'hh-shadow', type: 'circle', source: 'hh', maxzoom: 16.2, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16.5, 10], 'circle-color': P.hhShadow, 'circle-blur': 0.8, 'circle-opacity': zf(15.2, 16, 0.45, 0), 'circle-pitch-alignment': 'map' } },
    { id: 'hh-dot', type: 'circle', source: 'hh', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['match', ['get', 'status'], 'resolved', 1.6, 2.8], 16.5, ['match', ['get', 'status'], 'resolved', 3.5, 7]],
      'circle-color': statusExpr(c), 'circle-stroke-color': P.hhStroke, 'circle-stroke-width': ['match', ['get', 'status'], 'resolved', 0.6, 1.6], 'circle-pitch-alignment': 'map',
      'circle-opacity': zf(15.2, 16, 1, 0), 'circle-stroke-opacity': zf(15.2, 16, 1, 0) } },
    { id: 'hh-label', type: 'symbol', source: 'hh', minzoom: 15.8, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, -1.6], 'text-anchor': 'bottom', 'text-allow-overlap': false, 'symbol-sort-key': ['match', ['get', 'status'], 'urgent', 0, 'unreached', 1, 'assigned', 2, 3] },
      paint: { 'text-color': statusExpr(c), 'text-halo-color': P.halo, 'text-halo-width': 1.6, 'text-opacity': zf(15.8, 16.3, 0, 1) } });
  // without the demo households the hh layers stay as empty anchors; the footprint extrusion needs its source
  if (!SHOW_DEMO_HOUSEHOLDS) s.layers = s.layers.filter(l => l.id !== 'fp-3d');
  return s;
}
