// Haven map design options — shared synthetic data + geometry helpers.
// Everything here is FICTIONAL. Deterministic: same seed => same households.
'use strict';

const CENTER = [-96.752, 32.982]; // Richardson, TX (demo area only)
const STATUS = {
  urgent:     { label: 'Urgent',     color: '#e5484d', rank: 3 },
  unreached:  { label: 'Unreached',  color: '#f5a524', rank: 2 },
  assigned:   { label: 'Assigned',   color: '#12a594', rank: 1 },
  resolved:   { label: 'Resolved',   color: '#8b8d98', rank: 0 },
};
const NEEDS = ['Accessible transport', 'Power for medical equipment', 'Shelter space',
  'Water & supplies', 'Wellness check', 'Communication support', 'Caregiver help'];

// mulberry32 PRNG, seed 2026
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- local planar projection (meters) around CENTER; fine for a ~8 km demo area
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320 * Math.cos(CENTER[1] * Math.PI / 180);
function toXY([lng, lat]) { return [(lng - CENTER[0]) * M_PER_DEG_LNG, (lat - CENTER[1]) * M_PER_DEG_LAT]; }
function toLngLat([x, y]) { return [CENTER[0] + x / M_PER_DEG_LNG, CENTER[1] + y / M_PER_DEG_LAT]; }
function distM(a, b) { const p = toXY(a), q = toXY(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); }

// Synthetic creek corridor used by the hazard-zone demo (NOT a real flood model)
const CREEK = [[-96.795, 32.962], [-96.778, 32.969], [-96.764, 32.976], [-96.750, 32.981], [-96.735, 32.984], [-96.718, 32.983]];
function distToLineM(pt, line = CREEK) {
  const p = toXY(pt); let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = toXY(line[i]), b = toXY(line[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return best;
}

function makeHouseholds() {
  const rnd = makeRng(2026);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5; // ~N(0, .33), bounded
  const hubs = [ // [lng, lat, spreadMeters, share]
    [-96.765, 32.975, 700, 0.34], [-96.736, 32.994, 650, 0.24], [-96.752, 32.958, 600, 0.18], [CENTER[0], CENTER[1], 2600, 0.24]];
  const out = [];
  for (let i = 0; i < 160; i++) {
    let r = rnd(), h = hubs[hubs.length - 1];
    for (const hub of hubs) { if (r < hub[3]) { h = hub; break; } r -= hub[3]; }
    const [hx, hy] = toXY([h[0], h[1]]);
    const lnglat = toLngLat([hx + gauss() * h[2] * 1.4, hy + gauss() * h[2]]);
    const nearCreek = distToLineM(lnglat) < 700;
    const s = rnd();
    const status = nearCreek
      ? (s < 0.42 ? 'urgent' : s < 0.72 ? 'unreached' : s < 0.92 ? 'assigned' : 'resolved')
      : (s < 0.10 ? 'urgent' : s < 0.42 ? 'unreached' : s < 0.75 ? 'assigned' : 'resolved');
    const minute = Math.floor(status === 'urgent' ? rnd() * rnd() * 120 : rnd() * 120); // urgent skews early
    out.push({
      id: 'H-' + (1001 + i),
      name: 'Household ' + (1001 + i),
      lng: +lnglat[0].toFixed(6), lat: +lnglat[1].toFixed(6),
      status, need: NEEDS[Math.floor(rnd() * NEEDS.length)],
      people: 1 + Math.floor(rnd() * 5), minute,
      team: null,
    });
  }
  for (const h of out) if (h.status === 'assigned') h.team = nearestTeam(h).team.name;
  return out;
}

const TEAMS = [
  // Deliberately leaves the densest hub (around -96.765, 32.975) under-covered so the demos have a story.
  { id: 'T1', name: 'Team Alder',  lng: -96.779, lat: 32.991, capacity: 10 },
  { id: 'T2', name: 'Team Birch',  lng: -96.734, lat: 32.991, capacity: 10 },
  { id: 'T3', name: 'Team Cedar',  lng: -96.752, lat: 33.004, capacity: 10 },
  { id: 'T4', name: 'Team Dogwood', lng: -96.753, lat: 32.960, capacity: 10 },
];

function nearestTeam(h, teams = TEAMS) {
  let best = null, d = Infinity;
  for (const t of teams) { const dd = distM([h.lng, h.lat], [t.lng, t.lat]); if (dd < d) { d = dd; best = t; } }
  return { team: best, meters: d };
}

function fc(features) { return { type: 'FeatureCollection', features }; }
function householdsFC(list) {
  return fc(list.map(h => ({ type: 'Feature', id: undefined, properties: { ...h, rank: STATUS[h.status].rank }, geometry: { type: 'Point', coordinates: [h.lng, h.lat] } })));
}

// circle polygon of radius r meters around [lng,lat]
function circlePoly(center, r, steps = 64) {
  const [cx, cy] = toXY(center), ring = [];
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * 2 * Math.PI; ring.push(toLngLat([cx + r * Math.cos(a), cy + r * Math.sin(a)])); }
  return { type: 'Polygon', coordinates: [ring] };
}

// buffered corridor polygon around a polyline (round caps) — w meters each side
function corridorPoly(line, w) {
  const P = line.map(toXY), n = P.length, left = [], right = [];
  const segN = [];
  for (let i = 0; i < n - 1; i++) { const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1], L = Math.hypot(dx, dy); segN.push([-dy / L, dx / L]); }
  for (let i = 0; i < n; i++) {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(n - 2, i)];
    let nx = a[0] + b[0], ny = a[1] + b[1]; const L = Math.hypot(nx, ny); nx /= L; ny /= L;
    left.push([P[i][0] + nx * w, P[i][1] + ny * w]); right.push([P[i][0] - nx * w, P[i][1] - ny * w]);
  }
  const cap = (c, nrm, sign) => { const pts = [], base = Math.atan2(nrm[1], nrm[0]); for (let k = 1; k < 16; k++) { const ang = base + sign * Math.PI * k / 16; pts.push([c[0] + w * Math.cos(ang), c[1] + w * Math.sin(ang)]); } return pts; };
  const endN = segN[n - 2], startN = segN[0];
  const ring = [...left, ...cap(P[n - 1], endN, -1), ...right.reverse(), ...cap(P[0], [-startN[0], -startN[1]], -1)];
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring.map(toLngLat)] };
}

// pointy-top hex grid in local meters
function hexKey(x, y, s) {
  const q = (Math.sqrt(3) / 3 * x - y / 3) / s, r = (2 / 3 * y) / s;
  let cx = q, cz = r, cy = -cx - cz, rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
  const dx = Math.abs(rx - cx), dy = Math.abs(ry - cy), dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return [rx, rz];
}
function hexCenter(q, r, s) { return [s * Math.sqrt(3) * (q + r / 2), s * 1.5 * r]; }
function hexPoly(q, r, s) {
  const [cx, cy] = hexCenter(q, r, s), ring = [];
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 180 * (60 * (i % 6) - 30); ring.push(toLngLat([cx + s * 0.96 * Math.cos(a), cy + s * 0.96 * Math.sin(a)])); }
  return { type: 'Polygon', coordinates: [ring] };
}

const HOUSEHOLDS = makeHouseholds();
