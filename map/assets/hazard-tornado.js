// One MapLibre overlay controller: official live warnings plus two isolated synthetic demos.
'use strict';
(() => {
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const IEM_RADAR = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';
  const sim = globalThis.RICHARDSON_SIM;
  const tornado = sim.createMachine();
  const TORNADO_STATIC = sim.staticCollection();
  const HURRICANE_DURATION = 6500;
  const HURRICANE_TRACK = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'track', label: 'Simulated Gulf-to-North-Texas track' }, geometry: { type: 'LineString', coordinates: sim.HURRICANE_TRACK } }] };
  let view = 'live';
  let selection = null;
  let hurricanePhase = 'idle';
  let hurricaneStartedAt = 0;
  let hurricaneAfterAt = 0;
  let workflowStage = 0;
  let listening = false;
  let warningKey = '';
  let panelKey = '';
  let expiryTimer = 0;
  let lastTornadoMarker = null;
  let lastHurricaneMarker = null;
  let vehicleKey = '';
  let mode = 'night';
  let popup = null;
  const COL = {
    night: { warn: '#ff2d55', warnFill: 'rgba(255,45,85,0.20)', available: '#3ddc97', assigned: '#ffd166', en_route: '#7fe3ff', ring: '#021a20' },
    day: { warn: '#d40f3c', warnFill: 'rgba(212,15,60,0.14)', available: '#0e8a5f', assigned: '#b26b00', en_route: '#0f7d7a', ring: '#ffffff' },
  };
  const STATUS_LABEL = { available: 'Available', assigned: 'Assigned', en_route: 'En route' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tsMs = value => value?.microsSinceUnixEpoch === undefined ? undefined : Number(BigInt(value.microsSinceUnixEpoch) / 1000n);
  const when = value => { const ms = tsMs(value); return ms === undefined ? 'unknown' : new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

  const live = () => window.DIALEVAC;
  const radarOn = () => Boolean(document.getElementById('radar')?.checked);
  const source = (id) => window.__map?.getSource(id);
  const setData = (id, data) => source(id)?.setData(data);
  const point = (coordinates, properties = {}) => ({ type: 'FeatureCollection', features: coordinates ? [{ type: 'Feature', properties, geometry: { type: 'Point', coordinates } }] : [] });
  const phaseText = () => view === 'live' ? 'Live Weather' : view === 'tornado' ? (tornado.phase === 'during' ? 'During catastrophe' : tornado.phase === 'after' ? 'After catastrophe' : 'Ready') : (hurricanePhase === 'during' ? 'During catastrophe · Gulf-to-North-Texas playback' : hurricanePhase === 'after' ? 'After catastrophe · assistance workflow' : 'Ready');

  function liveKey(d) {
    const rows = [];
    for (const row of d.snapshot().zones.values()) rows.push(row.externalId, row.active ? '1' : '0', row.geometryJson || row.rings || '', row.headline || '', String(row.expiresAt?.microsSinceUnixEpoch || ''));
    return rows.join('\0');
  }
  function scheduleExpiry(d) {
    clearTimeout(expiryTimer);
    if (view !== 'live') return;
    const expiries = [...d.snapshot().zones.values()].map(row => row.expiresAt?.microsSinceUnixEpoch).filter(Boolean).map(value => Number(BigInt(value) / 1000n)).filter(ms => ms > Date.now()).sort((a, b) => a - b);
    if (expiries.length) expiryTimer = setTimeout(() => { warningKey = ''; applyWarnings(); scheduleExpiry(d); }, Math.min(2_147_000_000, Math.max(0, expiries[0] - Date.now() + 25)));
  }
  function applyWarnings() {
    const d = live();
    if (!d || view !== 'live') return;
    const next = liveKey(d);
    if (next !== warningKey) { warningKey = next; setData('tornado-warnings', d.warningCollection()); }
    const snap = d.snapshot();
    const vehicles = [...snap.vehicles.values()].map(v => `${v.id}:${v.lat}:${v.lng}:${d.vehicleStatus(v.id)}`).join('|');
    if (vehicles !== vehicleKey) { vehicleKey = vehicles; setData('live-vehicles', d.vehicleCollection()); }
  }
  function addRadar(map) {
    if (!map || view !== 'live' || map.getSource('iem-radar')) return;
    map.addSource('iem-radar', { type: 'raster', tiles: [IEM_RADAR], tileSize: 256, attribution: 'Radar: Iowa Environmental Mesonet / NWS' });
    map.addLayer({ id: 'iem-radar', type: 'raster', source: 'iem-radar', paint: { 'raster-opacity': 0.48, 'raster-fade-duration': 0 } }, map.getLayer('tornado-fill') ? 'tornado-fill' : undefined);
  }
  function removeRadar(map) {
    if (!map) return;
    if (map.getLayer('iem-radar')) map.removeLayer('iem-radar');
    if (map.getSource('iem-radar')) map.removeSource('iem-radar');
  }

  // Vehicles update several times a second; rebuilding unchanged markup would eat clicks on the list.
  function setHtml(el, html) { if (el && el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; } }
  function renderLivePanel() {
    const d = live();
    if (!d) return;
    const summary = d.feedSummary(), feed = document.getElementById('feed');
    feed.textContent = summary.text; feed.dataset.tone = summary.tone; feed.title = d.statusLine();
    document.getElementById('radar-meta').textContent = radarOn() ? d.radarLine() : 'IEM N0Q · off by default';
    document.getElementById('demo-db-status').textContent = d.demoStatusLine();
    const rows = d.liveWarnings();
    const next = rows.map(row => `${row.externalId}:${row.headline}:${row.expiresAt?.microsSinceUnixEpoch || ''}:${row.geometryJson ? 1 : 0}`).join('|');
    if (next !== panelKey) {
      panelKey = next;
      setHtml(document.getElementById('warns'), rows.map(row => `<button class="chip warn" data-key="${esc(row.externalId)}"><i></i><span>${esc(row.event)}<em>${esc(row.name)}</em></span><small>${row.expiresAt ? 'until ' + esc(d.formatTs(row.expiresAt)) : ''}${d.geometryOf(row) ? '' : ' · no map area'}</small></button>`).join(''));
    }
    const counts = d.fleetCounts(), c = COL[mode] || COL.night;
    setHtml(document.getElementById('fleet'), counts.total
      ? Object.keys(STATUS_LABEL).map(k => `<span><i style="--c:${c[k]}"></i>${STATUS_LABEL[k]} ${counts[k]}</span>`).join('') + (counts.simulated ? `<span class="sim">${counts.simulated === counts.total ? 'all' : counts.simulated} simulated</span>` : '')
      : '<span class="sim">No vehicles</span>');
  }
  function warningHtml(row) {
    const d = live(), link = /^https:\/\//.test(row.url || '') ? `<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Official alert ↗</a>` : '';
    return `<div class="k">${esc(row.source.toUpperCase())} · ${esc(row.severity || 'Unknown severity')}</div>`
      + `<h5>${esc(row.headline || row.event)}</h5><p>${esc(row.name)}</p>`
      + `<dl><dt>Issued</dt><dd>${esc(when(row.issuedAt))}</dd><dt>Expires</dt><dd>${esc(when(row.expiresAt))}</dd></dl>`
      + link + (d.geometryOf(row) ? '' : '<p>This alert has no polygon, so it is listed but not drawn.</p>');
  }
  function openWarning(externalId, lngLat) {
    const d = live(), map = window.__map, row = d?.snapshot().zones.get(externalId);
    if (!map || !row || view !== 'live') return;
    popup?.remove();
    const g = d.geometryOf(row);
    let at = lngLat;
    if (!at && g) {
      const pts = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(2);
      const b = pts.reduce((acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, duration: 1200 });
      at = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    }
    popup = new maplibregl.Popup({ className: 'live-pop', maxWidth: '300px' }).setLngLat(at || map.getCenter()).setHTML(warningHtml(row)).addTo(map);
  }
  window.DIALEVAC_LEGEND = m => {
    mode = m; queueMicrotask(renderLivePanel);
    const c = COL[m] || COL.night, dot = (color, label) => `<span><i style="--c:${color}"></i>${label}</span>`;
    return `<span><i style="--c:${c.warnFill};--stroke:${c.warn};border:1.5px solid ${c.warn};border-radius:3px"></i>Tornado warning</span>`
      + dot(c.available, 'Available') + dot(c.assigned, 'Assigned') + dot(c.en_route, 'En route');
  };

  function aftermathCollection() {
    const d = live(), snap = d?.demoSnapshot();
    if (!snap) return EMPTY;
    const features = [
      { type: 'Feature', properties: { kind: 'impact' }, geometry: { type: 'Polygon', coordinates: [[[-96.805,32.952],[-96.705,32.952],[-96.705,33.018],[-96.805,33.018],[-96.805,32.952]]] } },
      { type: 'Feature', properties: { kind: 'impact-label', label: 'Synthetic hurricane impact area · Richardson' }, geometry: { type: 'Point', coordinates: [-96.755, 33.011] } },
    ];
    for (const row of snap.roads.values()) if (row.active && row.source === 'simulated') features.push({ type: 'Feature', properties: { kind: 'road', label: row.street }, geometry: { type: 'Point', coordinates: [row.lng, row.lat] } });
    for (const row of snap.shelters.values()) features.push({ type: 'Feature', properties: { kind: 'shelter', label: row.name }, geometry: { type: 'Point', coordinates: [row.lng, row.lat] } });
    for (const row of snap.households.values()) if (row.riderId.startsWith('demo-richardson-')) features.push({ type: 'Feature', properties: { kind: 'household', selected: row.riderId.endsWith('wheelchair') ? 1 : 0, label: row.name, reason: row.riderId.endsWith('wheelchair') ? 'Wheelchair-accessible ride' : 'No response · welfare check pending' }, geometry: { type: 'Point', coordinates: [row.lng, row.lat] } });
    return { type: 'FeatureCollection', features };
  }
  function renderQueue() {
    const d = live(), snap = d?.demoSnapshot(); if (!snap) return;
    setData('aftermath', view === 'hurricane' && hurricanePhase === 'after' ? aftermathCollection() : EMPTY);
    const home = [...snap.households.values()].find(row => row.riderId === 'demo-richardson-wheelchair');
    const pending = [...snap.households.values()].find(row => row.riderId === 'demo-richardson-no-response');
    const request = home && [...snap.requests.values()].find(row => row.householdId === home.id);
    const assignment = request && [...snap.assignments.values()].find(row => row.requestId === request.id && ['proposed','offered','accepted'].includes(row.status));
    const vehicle = assignment && snap.vehicles.get(String(assignment.vehicleId));
    const shelter = assignment?.shelterId !== undefined && assignment?.shelterId !== null ? snap.shelters.get(String(assignment.shelterId)) : undefined;
    const queue = document.getElementById('dispatcher-queue');
    if (view !== 'hurricane' || hurricanePhase !== 'after') { queue.hidden = true; return; }
    queue.hidden = false;
    const status = assignment?.status === 'accepted' ? 'Driver accepted' : assignment?.status === 'offered' ? 'Dispatcher approved · awaiting driver' : 'Dispatcher review';
    queue.innerHTML = `<div class="queue-item selected"><b>${home?.name || 'Elena Ruiz'} · selected</b><span>Wheelchair-accessible ride · ${status}</span><span>${vehicle ? `${vehicle.name} (${vehicle.kind})` : 'Matching compatible van'}${shelter ? ` → ${shelter.name}` : ''}</span></div><div class="queue-item pending"><b>${pending?.name || 'No response household'}</b><span>No response after 2 simulated attempts · welfare check pending</span></div>`;
    const confirmation = document.getElementById('ride-confirmation');
    const accepted = assignment?.status === 'accepted';
    confirmation.hidden = !accepted;
    if (accepted) {
      const callback = [...snap.callbacks.values()].find(row => row.assignmentId === assignment.id && row.status === 'driver_accepted');
      confirmation.textContent = callback?.line || `Ride confirmed only after ${vehicle?.driverName || 'the simulated driver'} accepted.`;
    }
  }

  function renderDemoUi() {
    document.querySelectorAll('[data-demo]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.demo === selection)));
    document.getElementById('demo-phase').textContent = phaseText();
    document.getElementById('run-demo').disabled = !selection || live()?.demoSnapshot().state !== 'connected' || (view !== 'live' && phaseText().startsWith('During'));
    document.getElementById('reset-demo').disabled = view === 'live' || (tornado.phase === 'idle' && hurricanePhase === 'idle');
    document.getElementById('return-live').disabled = view === 'live';
    const title = document.getElementById('view-title'), subtitle = document.getElementById('view-subtitle');
    title.textContent = view === 'live' ? 'Live Weather' : view === 'tornado' ? 'Richardson Tornado' : 'Hurricane Aftermath';
    subtitle.textContent = view === 'live' ? 'Official NWS warning boundaries on the existing terrain map.' : view === 'tornado' ? 'Synthetic track, plume, impact corridor, and welfare checks.' : 'Synthetic damage and a real simulated dispatch state machine.';
  }
  function clearDemoSources() {
    for (const id of ['richardson-scenario-static','richardson-tornado','hurricane-track','hurricane-moving','aftermath']) setData(id, EMPTY);
    lastTornadoMarker = lastHurricaneMarker = null;
    document.getElementById('dispatcher-queue').hidden = true; document.getElementById('ride-confirmation').hidden = true;
  }
  // The live subscription keeps running; only its overlays leave the map during a demo.
  function hideLive() {
    clearTimeout(expiryTimer); popup?.remove(); popup = null;
    setData('tornado-warnings', EMPTY); setData('live-vehicles', EMPTY); warningKey = vehicleKey = '';
    removeRadar(window.__map);
  }
  function resetDemo() {
    tornado.reset(); hurricanePhase = 'idle'; hurricaneStartedAt = hurricaneAfterAt = workflowStage = 0; clearDemoSources(); renderDemoUi();
  }
  function returnLive() {
    resetDemo(); view = 'live'; warningKey = vehicleKey = ''; applyWarnings(); renderLivePanel(); scheduleExpiry(live()); if (radarOn()) addRadar(window.__map); renderDemoUi(); window.__map?.flyTo({ ...HOME, duration: 900, essential: true });
  }
  function runDemo() {
    if (!selection) return;
    resetDemo(); hideLive(); view = selection;
    const now = performance.now(), reduced = !window.__dialevacState?.motion;
    if (selection === 'tornado') {
      live()?.seedTornadoDemo();
      const result = tornado.start(reduced ? now - sim.DURATION_MS : now); lastTornadoMarker = result.marker;
      setData('richardson-scenario-static', TORNADO_STATIC); setData('richardson-tornado', sim.pointCollection(result.marker));
      window.__map?.flyTo({ center: sim.CENTER, zoom: 12.4, pitch: 38, bearing: -12, duration: reduced ? 0 : 900, essential: true });
    } else {
      live()?.seedAssistanceDemo(); hurricanePhase = 'during'; hurricaneStartedAt = reduced ? now - HURRICANE_DURATION : now;
      setData('hurricane-track', HURRICANE_TRACK); lastHurricaneMarker = sim.hurricanePositionAt(0); setData('hurricane-moving', point(lastHurricaneMarker, { kind: 'hurricane' }));
      window.__map?.flyTo({ center: [-96.0, 31.0], zoom: 5.4, pitch: 18, bearing: 0, duration: reduced ? 0 : 900, essential: true });
    }
    renderDemoUi();
  }
  function bindUi() {
    document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => { selection = button.dataset.demo; renderDemoUi(); }));
    document.getElementById('run-demo').addEventListener('click', runDemo);
    document.getElementById('reset-demo').addEventListener('click', resetDemo);
    document.getElementById('return-live').addEventListener('click', returnLive);
    document.getElementById('radar').addEventListener('change', event => { event.currentTarget.checked ? addRadar(window.__map) : removeRadar(window.__map); renderLivePanel(); });
    document.getElementById('warns').addEventListener('click', event => { const button = event.target.closest('[data-key]'); if (button) openWarning(button.dataset.key); });
  }
  function hookMap(map) {
    if (!map || map.__dialevacWeatherHooked) return;
    map.__dialevacWeatherHooked = true;
    map.on('click', 'tornado-fill', event => { const feature = event.features?.[0]; if (feature) openWarning(feature.properties.externalId, event.lngLat); });
    map.on('mouseenter', 'tornado-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'tornado-fill', () => { map.getCanvas().style.cursor = ''; });
  }
  function ensureListeners() {
    const d = live(); if (!d || listening) return;
    listening = true;
    d.subscribeGeometry(() => { if (view === 'live') { applyWarnings(); scheduleExpiry(d); } renderLivePanel(); });
    d.subscribeStatus(() => { renderLivePanel(); renderDemoUi(); });
    d.subscribeDemo(() => { renderDemoUi(); renderQueue(); });
    setInterval(renderLivePanel, 30000); // staleness moves with the clock, not with row changes
    renderLivePanel(); renderDemoUi();
  }

  HAZARDS.push({
    id: 'tornado', label: 'NWS warnings', note: 'live', defaultOn: true,
    addTo(style, styleMode) {
      const d = live();
      mode = styleMode || mode;
      const c = COL[mode] || COL.night;
      warningKey = vehicleKey = '';
      style.sources['tornado-warnings'] = { type: 'geojson', data: view === 'live' && d ? d.warningCollection() : EMPTY, attribution: 'Warnings: National Weather Service' };
      style.sources['live-vehicles'] = { type: 'geojson', data: view === 'live' && d ? d.vehicleCollection() : EMPTY };
      style.sources['richardson-scenario-static'] = { type: 'geojson', data: view === 'tornado' && tornado.phase !== 'idle' ? TORNADO_STATIC : EMPTY };
      style.sources['richardson-tornado'] = { type: 'geojson', data: view === 'tornado' && lastTornadoMarker ? sim.pointCollection(lastTornadoMarker) : EMPTY };
      style.sources['hurricane-track'] = { type: 'geojson', data: view === 'hurricane' && hurricanePhase !== 'idle' ? HURRICANE_TRACK : EMPTY };
      style.sources['hurricane-moving'] = { type: 'geojson', data: view === 'hurricane' && lastHurricaneMarker ? point(lastHurricaneMarker, { kind: 'hurricane' }) : EMPTY };
      style.sources.aftermath = { type: 'geojson', data: view === 'hurricane' && hurricanePhase === 'after' ? aftermathCollection() : EMPTY };
      if (view === 'live' && radarOn()) style.sources['iem-radar'] = { type: 'raster', tiles: [IEM_RADAR], tileSize: 256, attribution: 'Radar: Iowa Environmental Mesonet / NWS' };
      const before = style.layers.findIndex(layer => layer.id === 'hh-shadow'), at = before < 0 ? style.layers.length : before;
      const layers = [
        ...(view === 'live' && radarOn() ? [{ id: 'iem-radar', type: 'raster', source: 'iem-radar', paint: { 'raster-opacity': 0.48, 'raster-fade-duration': 0 } }] : []),
        { id: 'tornado-fill', type: 'fill', source: 'tornado-warnings', paint: { 'fill-color': c.warnFill } },
        { id: 'tornado-outline', type: 'line', source: 'tornado-warnings', paint: { 'line-color': c.warn, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 3] } },
        { id: 'richardson-impact', type: 'fill', source: 'richardson-scenario-static', filter: ['==',['get','kind'],'impact'], paint: { 'fill-color': '#e66b3d', 'fill-opacity': 0.16 } },
        { id: 'richardson-track', type: 'line', source: 'richardson-scenario-static', filter: ['==',['get','kind'],'track'], paint: { 'line-color': '#ffe5c7', 'line-width': 1.4, 'line-dasharray': [2,3] } },
        { id: 'demo-checks', type: 'circle', source: 'richardson-scenario-static', filter: ['==',['get','kind'],'check'], paint: { 'circle-radius': 6, 'circle-color': '#e2b657', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.4 } },
        { id: 'tornado-plume-outer', type: 'circle', source: 'richardson-tornado', paint: { 'circle-radius': ['interpolate',['linear'],['zoom'],10,24,14,70], 'circle-color': 'rgba(205,130,90,.18)', 'circle-blur': 1 } },
        { id: 'tornado-plume-inner', type: 'circle', source: 'richardson-tornado', paint: { 'circle-radius': ['interpolate',['linear'],['zoom'],10,12,14,34], 'circle-color': 'rgba(238,190,145,.22)', 'circle-blur': .75 } },
        { id: 'richardson-tornado-marker', type: 'circle', source: 'richardson-tornado', paint: { 'circle-radius': 7, 'circle-color': '#2b1712', 'circle-stroke-color': '#ffb36b', 'circle-stroke-width': 2.4 } },
        { id: 'hurricane-demo-track', type: 'line', source: 'hurricane-track', paint: { 'line-color': '#9ad8ff', 'line-width': 2, 'line-dasharray': [2,2] } },
        { id: 'hurricane-demo-marker', type: 'circle', source: 'hurricane-moving', paint: { 'circle-radius': 10, 'circle-color': '#ff5f78', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } },
        { id: 'aftermath-impact', type: 'fill', source: 'aftermath', filter: ['==',['get','kind'],'impact'], paint: { 'fill-color': '#647d91', 'fill-opacity': .2 } },
        { id: 'aftermath-roads', type: 'circle', source: 'aftermath', filter: ['==',['get','kind'],'road'], paint: { 'circle-radius': 7, 'circle-color': '#d85c4a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
        { id: 'aftermath-shelters', type: 'circle', source: 'aftermath', filter: ['==',['get','kind'],'shelter'], paint: { 'circle-radius': 8, 'circle-color': '#55b989', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.8 } },
        { id: 'aftermath-households', type: 'circle', source: 'aftermath', filter: ['==',['get','kind'],'household'], paint: { 'circle-radius': ['case',['==',['get','selected'],1],10,7], 'circle-color': ['case',['==',['get','selected'],1],'#ffb36b','#e2b657'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
      ];
      style.layers.splice(at, 0, ...layers);
      const P = PAL[mode] || {};
      style.layers.push(
        { id: 'live-veh-ring', type: 'circle', source: 'live-vehicles', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 11], 'circle-color': c.ring, 'circle-pitch-alignment': 'map',
          'circle-stroke-width': 3, 'circle-stroke-color': ['match', ['get', 'status'], 'en_route', c.en_route, 'assigned', c.assigned, c.available],
          'circle-opacity': ['case', ['get', 'simulated'], 0.7, 1] } },
        { id: 'live-veh-dot', type: 'circle', source: 'live-vehicles', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 16, 4.5], 'circle-pitch-alignment': 'map',
          'circle-color': ['match', ['get', 'status'], 'en_route', c.en_route, 'assigned', c.assigned, c.available] } },
        { id: 'live-veh-label', type: 'symbol', source: 'live-vehicles', minzoom: 12, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-allow-overlap': false },
          paint: { 'text-color': P.label || '#fff', 'text-halo-color': P.halo || 'rgba(4,20,26,.9)', 'text-halo-width': 1.6 } },
        { id: 'demo-labels', type: 'symbol', source: 'richardson-scenario-static', filter: ['in',['get','kind'],['literal',['label','check']]], layout: { 'text-field': ['coalesce',['get','label'],['get','reason']], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-offset': [0,1.2], 'text-anchor': 'top' }, paint: { 'text-color': '#fff2df', 'text-halo-color': 'rgba(4,20,26,.9)', 'text-halo-width': 1.5 } },
        { id: 'aftermath-labels', type: 'symbol', source: 'aftermath', filter: ['in',['get','kind'],['literal',['impact-label','road','shelter','household']]], layout: { 'text-field': ['get','label'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-offset': [0,1.2], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(4,20,26,.92)', 'text-halo-width': 1.5 } });
    },
    toggled(map, on) { if (!on) { popup?.remove(); popup = null; removeRadar(map); } else if (view === 'live') { applyWarnings(); if (radarOn()) addRadar(map); } renderLivePanel(); },
    tick(map, _t, _dt, appState) {
      hookMap(map);
      const now = performance.now();
      if (view === 'tornado' && tornado.phase === 'during') {
        const result = tornado.advance(appState.motion ? now : Number.POSITIVE_INFINITY); lastTornadoMarker = result.marker;
        setData('richardson-tornado', sim.pointCollection(result.marker)); if (result.completed) renderDemoUi();
      }
      if (view === 'hurricane' && hurricanePhase === 'during') {
        const progress = appState.motion ? (now - hurricaneStartedAt) / HURRICANE_DURATION : 1;
        lastHurricaneMarker = sim.hurricanePositionAt(progress); setData('hurricane-moving', point(lastHurricaneMarker, { kind: 'hurricane' }));
        if (progress >= 1) {
          hurricanePhase = 'after'; hurricaneAfterAt = now; workflowStage = 0; setData('aftermath', aftermathCollection());
          map.flyTo({ center: sim.CENTER, zoom: 12.4, pitch: 38, bearing: -12, duration: appState.motion ? 900 : 0, essential: true }); renderDemoUi(); renderQueue();
        }
      }
      if (view === 'hurricane' && hurricanePhase === 'after') {
        if (workflowStage === 0 && now - hurricaneAfterAt > 900) { workflowStage = 1; live()?.advanceAssistanceDemo('approve'); }
        if (workflowStage === 1 && now - hurricaneAfterAt > 2400) { workflowStage = 2; live()?.advanceAssistanceDemo('accept'); }
      }
      return view === 'live' ? '' : `${view === 'tornado' ? sim.LABEL : 'Simulated · Hurricane Aftermath'} · ${phaseText()}`;
    },
  });

  ensureListeners();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi); else bindUi();
  window.__dialevacDemoDebug = () => ({ view, selection, tornadoPhase: tornado.phase, hurricanePhase, workflowStage, listeners: live()?.listenerCounts(), frameLoops: window.__dialevacState?.frameLoopCount });
})();
