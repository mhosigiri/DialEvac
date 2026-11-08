// Live NWS warnings and the map-only Richardson scenario deliberately use separate sources.
'use strict';
(() => {
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const IEM_RADAR = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';
  const KIND_COLOR = ['match', ['get', 'kind'], 'live', '#c45c26', 'nws', '#c45c26', 'replay', '#9b7ed9', '#c45c26'];
  const sim = globalThis.RICHARDSON_SIM;
  const machine = sim.createMachine();
  let listening = false;
  let warningKey = '';
  let panelKey = '';

  function live() { return window.DIALEVAC; }
  function radarOn() { return Boolean(document.getElementById('radar')?.checked); }
  function isScenarioZone(d, z) { return z.externalId === 'sim-tornado' || z.source === 'stand-in' || d.displayKind(z) === 'simulated'; }
  function zoneKey(d) {
    const parts = [];
    for (const z of d.snapshot().zones.values()) {
      if (isScenarioZone(d, z)) continue;
      parts.push(z.externalId, z.active ? '1' : '0', z.kind || '', z.source, z.geometryJson || z.rings || '', String(z.expiresAt?.microsSinceUnixEpoch || ''));
    }
    return parts.join('\0');
  }

  function applyWarnings(map) {
    const d = live(), source = map?.getSource('tornado-warnings');
    if (!d || !source) return;
    const next = zoneKey(d);
    if (next !== warningKey) { warningKey = next; source.setData(d.warningCollection()); }
  }
  function phaseText(phase) { return phase === 'during' ? 'During catastrophe' : phase === 'after' ? 'After catastrophe' : 'Ready'; }
  function renderSimulationUi() {
    const d = live();
    const localReady = Boolean(d?.isLocalDemo() && d.snapshot().state === 'connected');
    const start = document.getElementById('simulation-start'), reset = document.getElementById('simulation-reset'), phase = document.getElementById('simulation-phase');
    if (start) start.disabled = !localReady || machine.phase === 'during';
    if (reset) reset.disabled = machine.phase === 'idle';
    if (phase) phase.textContent = phaseText(machine.phase);
  }
  function renderPanel() {
    const d = live();
    const liveStatus = document.getElementById('live-status'), feedStatus = document.getElementById('feed-status'), radarMeta = document.getElementById('radar-meta');
    if (liveStatus) liveStatus.textContent = d ? d.statusLine() : 'connecting';
    if (feedStatus) feedStatus.textContent = d ? d.feedLine() : 'feed: waiting';
    if (radarMeta) radarMeta.textContent = d ? d.radarLine() : 'IEM N0Q';
    renderSimulationUi();
    const warnings = document.getElementById('warnings');
    if (!warnings || !d) return;
    const active = [...d.snapshot().zones.values()].filter(z => z.active && !d.isExpired(z) && !isScenarioZone(d, z));
    const next = active.map(z => z.externalId + (z.headline || z.event)).join('|');
    if (next === panelKey) return;
    panelKey = next;
    warnings.replaceChildren();
  }
  function setScenarioData(map, showStatic, marker) {
    map?.getSource('richardson-scenario-static')?.setData(showStatic ? sim.staticCollection() : sim.empty());
    map?.getSource('richardson-tornado')?.setData(sim.pointCollection(marker));
  }
  function startScenario() {
    const d = live();
    if (!d?.seedTornadoDemo()) return;
    const result = machine.start(performance.now());
    setScenarioData(window.__map, true, result.marker);
    renderSimulationUi();
    // This is the scenario's only camera change. Marker updates never touch the camera.
    window.__map?.flyTo({ center: sim.CENTER, zoom: 12.4, pitch: 38, bearing: -12, duration: 1200, essential: true });
  }
  function resetScenario() {
    machine.reset();
    setScenarioData(window.__map, false, null);
    renderSimulationUi();
  }
  function addRadar(map) {
    if (!map || map.getSource('iem-radar')) return;
    map.addSource('iem-radar', { type: 'raster', tiles: [IEM_RADAR], tileSize: 256, attribution: 'Radar: Iowa Environmental Mesonet / NWS' });
    if (!map.getLayer('iem-radar')) map.addLayer({ id: 'iem-radar', type: 'raster', source: 'iem-radar', paint: { 'raster-opacity': 0.55, 'raster-fade-duration': 0 } }, map.getLayer('tornado-fill') ? 'tornado-fill' : undefined);
  }
  function removeRadar(map) {
    if (!map) return;
    if (map.getLayer('iem-radar')) map.removeLayer('iem-radar');
    if (map.getSource('iem-radar')) map.removeSource('iem-radar');
  }
  function hookMap(map) {
    if (!map || map.__tornadoHooked) return;
    map.__tornadoHooked = true;
    map.on('style.load', () => {
      warningKey = '';
      applyWarnings(map);
      setScenarioData(map, machine.phase !== 'idle', machine.phase === 'idle' ? null : sim.positionAt(machine.phase === 'after' ? 1 : 0));
      if (radarOn()) addRadar(map);
    });
  }
  function ensureListen() {
    const d = live();
    if (!d || listening) return;
    listening = true;
    d.subscribeGeometry?.(() => applyWarnings(window.__map));
    d.subscribeStatus?.(renderPanel);
    renderPanel();
  }
  function bindUi() {
    document.getElementById('simulation-start')?.addEventListener('click', startScenario);
    document.getElementById('simulation-reset')?.addEventListener('click', resetScenario);
    document.getElementById('radar')?.addEventListener('change', e => e.currentTarget.checked ? addRadar(window.__map) : removeRadar(window.__map));
  }

  HAZARDS.push({
    id: 'tornado', label: 'Tornado', note: 'simulation + NWS', defaultOn: true,
    addTo(s) {
      const d = live();
      warningKey = '';
      s.sources['tornado-warnings'] = { type: 'geojson', data: d ? d.warningCollection() : EMPTY };
      s.sources['richardson-scenario-static'] = { type: 'geojson', data: machine.phase === 'idle' ? sim.empty() : sim.staticCollection() };
      s.sources['richardson-tornado'] = { type: 'geojson', data: machine.phase === 'idle' ? sim.empty() : sim.pointCollection(sim.positionAt(machine.phase === 'after' ? 1 : 0)) };
      const hh = s.layers.findIndex(l => l.id === 'hh-shadow'), at = hh === -1 ? s.layers.length : hh;
      s.layers.splice(at, 0,
        { id: 'tornado-fill', type: 'fill', source: 'tornado-warnings', paint: { 'fill-color': KIND_COLOR, 'fill-opacity': 0.08 } },
        { id: 'tornado-outline', type: 'line', source: 'tornado-warnings', paint: { 'line-color': KIND_COLOR, 'line-width': 1, 'line-opacity': 0.9 } },
        { id: 'richardson-impact', type: 'fill', source: 'richardson-scenario-static', filter: ['==', ['get', 'kind'], 'impact'], paint: { 'fill-color': '#e66b3d', 'fill-opacity': 0.18 } },
        { id: 'richardson-track', type: 'line', source: 'richardson-scenario-static', filter: ['==', ['get', 'kind'], 'track'], paint: { 'line-color': '#ffe5c7', 'line-width': 1.5, 'line-dasharray': [2, 3], 'line-opacity': 0.9 } },
        { id: 'richardson-label', type: 'symbol', source: 'richardson-scenario-static', filter: ['==', ['get', 'kind'], 'label'], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.4], 'text-allow-overlap': true }, paint: { 'text-color': '#ffe5c7', 'text-halo-color': 'rgba(4,20,26,.9)', 'text-halo-width': 1.5 } },
        { id: 'richardson-tornado-marker', type: 'circle', source: 'richardson-tornado', paint: { 'circle-radius': 9, 'circle-color': '#2b1712', 'circle-stroke-color': '#ffb36b', 'circle-stroke-width': 3 } },
      );
    },
    tick(map) {
      hookMap(map);
      if (machine.phase === 'during') {
        const result = machine.advance(performance.now());
        map.getSource('richardson-tornado')?.setData(sim.pointCollection(result.marker));
        if (result.completed) renderSimulationUi();
      }
      return machine.phase === 'idle' ? '' : `${sim.LABEL} · ${phaseText(machine.phase)}`;
    },
  });

  ensureListen();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
  else bindUi();
})();
