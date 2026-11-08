// Live layers: official tornado warnings, feed health, the simulated hazard zone and response vehicles.
// Rows arrive from assets/live-data.js (built from live/src). Everything here draws what the rows say
// and nothing more: a warning polygon is the official alert area, never a forecast of the hazard.
'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const ALL_EVENTS = params.get('events') === 'all';
  const WARNING_EVENTS = ['Tornado Warning'];
  const STALE_MS = 6 * 60 * 1000; // the feed polls every 2 minutes; three missed polls is stale
  const COL = {
    night: { warn: '#ff2d55', warnFill: 'rgba(255,45,85,0.20)', sim: '#ffd166', simFill: 'rgba(255,209,102,0.07)', available: '#3ddc97', assigned: '#ffd166', en_route: '#7fe3ff', ring: '#021a20' },
    day: { warn: '#d40f3c', warnFill: 'rgba(212,15,60,0.14)', sim: '#b26b00', simFill: 'rgba(178,107,0,0.06)', available: '#0e8a5f', assigned: '#b26b00', en_route: '#0f7d7a', ring: '#ffffff' },
  };
  const STATUS_LABEL = { available: 'Available', assigned: 'Assigned', en_route: 'En route' };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clock = ms => (ms == null ? 'unknown' : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  const when = ms => (ms == null ? 'unknown' : new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));

  // ---------- pure logic (also run by live/tests) ----------
  function shownWarnings(rows, now, allEvents = ALL_EVENTS) {
    return rows
      .filter(w => allEvents || WARNING_EVENTS.includes(w.event))
      .filter(w => w.expiresAt == null || w.expiresAt > now)
      .sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  }
  function parseGeometry(text) {
    if (!text) return null;
    try {
      const g = JSON.parse(text);
      return g && (g.type === 'Polygon' || g.type === 'MultiPolygon') && Array.isArray(g.coordinates) ? g : null;
    } catch { return null; }
  }
  function vehicleStatus(vehicleId, assignments) {
    const mine = assignments.filter(a => a.vehicleId === vehicleId);
    if (mine.some(a => a.status === 'accepted')) return 'en_route';
    if (mine.some(a => a.status === 'proposed' || a.status === 'offered')) return 'assigned';
    return 'available';
  }
  function feedSummary(feeds, connection, shownCount, now) {
    if (connection !== 'live') return { tone: 'warn', text: connection === 'connecting' ? 'Connecting to live data…' : 'Live data offline · warnings are not updating' };
    const f = feeds.find(x => x.source === 'nws');
    if (!f) return { tone: 'warn', text: 'Waiting for the NWS warning feed' };
    if (f.state === 'loading') return { tone: 'muted', text: 'NWS · loading warnings…' };
    if (f.state === 'off') return { tone: 'warn', text: 'NWS feed is off (no area set)' };
    const fresh = f.state === 'current' && f.lastSuccessfulPollAt != null && now - f.lastSuccessfulPollAt < STALE_MS;
    if (!fresh) return { tone: 'warn', text: `Unable to refresh warnings · last update ${f.lastSuccessfulPollAt == null ? 'never' : clock(f.lastSuccessfulPollAt)}` };
    const what = ALL_EVENTS ? 'alert' : 'tornado warning';
    const n = shownCount;
    return { tone: n ? 'alert' : 'ok', text: `${n ? n : 'No'} active ${what}${n === 1 ? '' : 's'} · NWS updated ${clock(f.lastSuccessfulPollAt)}` };
  }
  function collections(snap, now) {
    const warn = { type: 'FeatureCollection', features: [] };
    for (const w of shownWarnings(snap.warnings, now)) {
      const g = parseGeometry(w.geometry);
      if (g) warn.features.push({ type: 'Feature', geometry: g, properties: { key: w.key } });
    }
    const sim = { type: 'FeatureCollection', features: [] };
    for (const z of snap.zones) {
      let rings = null;
      try { rings = JSON.parse(z.rings); } catch { /* skip a bad row */ }
      if (Array.isArray(rings) && rings.length) sim.features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties: { id: z.id, label: 'SIMULATED · ' + z.event } });
    }
    const veh = { type: 'FeatureCollection', features: snap.vehicles.map(v => {
      const status = vehicleStatus(v.id, snap.assignments);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] }, properties: {
        id: v.id, status, simulated: v.simulated, label: `${v.name} · ${STATUS_LABEL[status]}${v.simulated ? ' · SIM' : ''}` } };
    }) };
    return { warn, sim, veh };
  }

  // ---------- state ----------
  const empty = { warnings: [], feeds: [], zones: [], vehicles: [], assignments: [] };
  let snap = empty, connection = 'connecting', connectionDetail = '', fc = collections(empty, Date.now()), mode = 'night', popup = null;
  const map = () => window.__map;

  function addTo(s, m) {
    mode = m;
    const c = COL[m];
    fc = collections(snap, Date.now());
    s.sources['live-warn'] = { type: 'geojson', data: fc.warn, attribution: 'Warnings: National Weather Service' };
    s.sources['live-sim'] = { type: 'geojson', data: fc.sim };
    s.sources['live-veh'] = { type: 'geojson', data: fc.veh };
    const at = s.layers.findIndex(l => l.id === 'hh-shadow');
    const below = [
      { id: 'live-sim-fill', type: 'fill', source: 'live-sim', paint: { 'fill-color': c.simFill } },
      { id: 'live-sim-line', type: 'line', source: 'live-sim', paint: { 'line-color': c.sim, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.9 } },
      { id: 'live-warn-fill', type: 'fill', source: 'live-warn', paint: { 'fill-color': c.warnFill } },
      { id: 'live-warn-line', type: 'line', source: 'live-warn', paint: { 'line-color': c.warn, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 3] } },
    ];
    s.layers.splice(at < 0 ? s.layers.length : at, 0, ...below);
    s.layers.push(
      { id: 'live-sim-label', type: 'symbol', source: 'live-sim', layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'symbol-spacing': 420 },
        paint: { 'text-color': c.sim, 'text-halo-color': PAL[m].halo, 'text-halo-width': 1.6 } },
      { id: 'live-veh-ring', type: 'circle', source: 'live-veh', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 11], 'circle-color': c.ring, 'circle-pitch-alignment': 'map',
        'circle-stroke-width': 3, 'circle-stroke-color': ['match', ['get', 'status'], 'en_route', c.en_route, 'assigned', c.assigned, c.available],
        'circle-opacity': ['case', ['get', 'simulated'], 0.7, 1] } },
      { id: 'live-veh-dot', type: 'circle', source: 'live-veh', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 16, 4.5], 'circle-pitch-alignment': 'map',
        'circle-color': ['match', ['get', 'status'], 'en_route', c.en_route, 'assigned', c.assigned, c.available] } },
      { id: 'live-veh-label', type: 'symbol', source: 'live-veh', minzoom: 12, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-allow-overlap': false },
        paint: { 'text-color': PAL[m].label, 'text-halo-color': PAL[m].halo, 'text-halo-width': 1.6 } },
    );
  }

  function push() {
    const m = map();
    fc = collections(snap, Date.now());
    if (!m) return;
    for (const [id, data] of [['live-warn', fc.warn], ['live-sim', fc.sim], ['live-veh', fc.veh]]) {
      const src = m.getSource(id);
      if (src) src.setData(data);
    }
  }

  // ---------- panel ----------
  function renderPanel() {
    const now = Date.now(), shown = shownWarnings(snap.warnings, now), s = feedSummary(snap.feeds, connection, shown.length, now);
    const feed = document.getElementById('feed');
    if (feed) { feed.textContent = s.text; feed.dataset.tone = s.tone; feed.title = connectionDetail; }
    const list = document.getElementById('warns');
    if (list) setHtml(list, shown.map(w => `<button class="chip warn" data-key="${esc(w.key)}"><i></i><span>${esc(w.event)}<em>${esc(w.areaDescription)}</em></span><small>${w.expiresAt ? 'until ' + esc(clock(w.expiresAt)) : ''}${parseGeometry(w.geometry) ? '' : ' · no map area'}</small></button>`).join(''));
    const counts = { available: 0, assigned: 0, en_route: 0 };
    let simulated = 0;
    for (const v of snap.vehicles) { counts[vehicleStatus(v.id, snap.assignments)] += 1; if (v.simulated) simulated += 1; }
    const fleet = document.getElementById('fleet');
    if (fleet) {
      const c = COL[mode];
      setHtml(fleet, snap.vehicles.length
        ? Object.keys(counts).map(k => `<span><i style="--c:${c[k]}"></i>${STATUS_LABEL[k]} ${counts[k]}</span>`).join('') + (simulated ? `<span class="sim">${simulated === snap.vehicles.length ? 'all' : simulated} simulated</span>` : '')
        : '<span class="sim">No vehicles</span>');
    }
  }
  // Vehicles update several times a second; rebuilding unchanged markup would eat clicks on the list.
  function setHtml(el, html) { if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; } }

  function warningHtml(w) {
    const link = /^https:\/\//.test(w.officialUrl) ? `<a href="${esc(w.officialUrl)}" target="_blank" rel="noopener noreferrer">Official alert ↗</a>` : '';
    return `<div class="k">${esc(w.source.toUpperCase())} · ${esc(w.severity || 'Unknown severity')}${w.status && w.status !== 'Actual' ? ' · ' + esc(w.status) : ''}</div>`
      + `<h5>${esc(w.headline || w.event)}</h5>`
      + `<p>${esc(w.areaDescription)}</p>`
      + `<dl><dt>Issued</dt><dd>${esc(when(w.issuedAt))}</dd><dt>Expires</dt><dd>${esc(when(w.expiresAt))}</dd></dl>`
      + link
      + (parseGeometry(w.geometry) ? '' : '<p class="note">This alert has no polygon, so it is listed but not drawn.</p>');
  }

  function openWarning(key, lngLat) {
    const m = map(), w = snap.warnings.find(x => x.key === key);
    if (!m || !w) return;
    popup?.remove();
    const g = parseGeometry(w.geometry);
    let at = lngLat;
    if (!at && g) {
      const pts = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(2);
      const b = pts.reduce((acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
      m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, duration: 1200 });
      at = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    }
    popup = new maplibregl.Popup({ className: 'live-pop', maxWidth: '300px' }).setLngLat(at || m.getCenter()).setHTML(warningHtml(w)).addTo(m);
  }

  // ---------- wiring ----------
  window.LIVE = {
    addTo,
    update(next) { snap = next; push(); renderPanel(); },
    setConnection(state, detail = '') { connection = state; connectionDetail = detail; renderPanel(); },
    _pure: { shownWarnings, parseGeometry, vehicleStatus, feedSummary, collections },
  };

  window.addEventListener('DOMContentLoaded', () => {
    renderPanel();
    document.getElementById('warns')?.addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (b) openWarning(b.dataset.key); });
    const wait = setInterval(() => {
      const m = map();
      if (!m) return;
      clearInterval(wait);
      m.on('click', 'live-warn-fill', e => { const f = e.features && e.features[0]; if (f) openWarning(f.properties.key, e.lngLat); });
      m.on('mouseenter', 'live-warn-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'live-warn-fill', () => { m.getCanvas().style.cursor = ''; });
    }, 100);
    setInterval(() => { push(); renderPanel(); }, 30000); // expiry and staleness move with the clock
  });
})();
