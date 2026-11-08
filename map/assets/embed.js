// Operator portal mode (?embed=1). The portal owns the controls and the case data, so the frame shows
// only the map and the resident the dispatcher selected. Without the flag this file does nothing.
'use strict';
(() => {
  if (!new URLSearchParams(location.search).has('embed')) return;
  document.documentElement.classList.add('embed');

  const SELECTED_ZOOM = 14.5;
  const REFIT_WAIT_MS = 1000;
  const SEVERITY_COLOR = { critical: '#ff2d55', high: '#ff9f43', medium: '#7c9cff', low: '#8f96a3', cleared: '#3ddc97' };
  const CASES_SOURCE = 'portal-cases';
  const ROUTE_SOURCE = 'portal-route';
  const ZONE_SOURCE = 'portal-zone';
  const EMPTY = { type: 'FeatureCollection', features: [] };
  let marker;
  let pinLabel;
  let cases = [];
  let framedKey;
  let route = null;
  let framedRoute;
  let routeCoveredRight = 0;
  let selection = null;
  let responder = null;
  let responderMarker;
  let zone = EMPTY;
  let readyVersion;

  function validSelection(s) {
    return !!s && typeof s.label === 'string' && Number.isFinite(s.lat) && Number.isFinite(s.lng) && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180;
  }

  function clearSelection() {
    marker?.remove();
    marker = undefined;
  }

  function showSelection({ lat, lng, label }) {
    const map = window.__map;
    if (!marker) {
      const pin = document.createElement('div');
      pin.className = 'embed-pin';
      pinLabel = document.createElement('span');
      pin.append(pinLabel, document.createElement('i'));
      marker = new maplibregl.Marker({ element: pin, anchor: 'bottom' });
    }
    pinLabel.textContent = `${label} · ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    marker.setLngLat([lng, lat]).addTo(map);
    if (route) { framedRoute = undefined; frameRoute(map); }
    else map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), SELECTED_ZOOM), duration: window.__dialevacState?.motion ? 900 : 0 });
  }

  function showResponder(map) {
    if (!responder) { responderMarker?.remove(); responderMarker = undefined; return; }
    if (!responderMarker) {
      const pin = document.createElement('div');
      pin.className = 'embed-pin embed-unit';
      const label = document.createElement('span');
      pin.append(label, document.createElement('i'));
      responderMarker = new maplibregl.Marker({ element: pin, anchor: 'bottom' });
      responderMarker.label = label;
    }
    responderMarker.label.textContent = `${responder.label} · ${responder.lat.toFixed(5)}, ${responder.lng.toFixed(5)}`;
    responderMarker.setLngLat([responder.lng, responder.lat]).addTo(map);
  }

  const casesGeoJson = () => ({
    type: 'FeatureCollection',
    features: cases.map(c => ({ type: 'Feature', properties: { id: c.id, label: c.label, color: SEVERITY_COLOR[c.severity] ?? SEVERITY_COLOR.low }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })),
  });

  const routeGeoJson = () => route
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.map(p => [p.lng, p.lat]) } }
    : EMPTY;

  // The relief palette turns cream at this region's elevation, even at night, which glares inside a dark portal.
  function addDim(map) {
    if (map.getLayer('portal-dim')) return;
    map.addLayer({ id: 'portal-dim', type: 'background', paint: { 'background-color': '#060607', 'background-opacity': 0.62 } }, map.getStyle().layers.find(l => l.type === 'symbol')?.id);
  }

  // Added together so the zone stays under the route and the route under the case dots.
  function addLayers(map) {
    map.addSource(ZONE_SOURCE, { type: 'geojson', data: zone });
    map.addLayer({ id: `${ZONE_SOURCE}-fill`, type: 'fill', source: ZONE_SOURCE, paint: { 'fill-color': '#ff2d55', 'fill-opacity': 0.04 } });
    map.addLayer({ id: `${ZONE_SOURCE}-line`, type: 'line', source: ZONE_SOURCE, paint: { 'line-color': '#ff2d55', 'line-width': 2, 'line-dasharray': [2, 2] } });
    map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routeGeoJson() });
    map.addLayer({ id: `${ROUTE_SOURCE}-casing`, type: 'line', source: ROUTE_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    map.addLayer({ id: ROUTE_SOURCE, type: 'line', source: ROUTE_SOURCE, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2563eb', 'line-width': 4 } });
    map.addSource(CASES_SOURCE, { type: 'geojson', data: casesGeoJson() });
    map.addLayer({ id: CASES_SOURCE, type: 'circle', source: CASES_SOURCE, paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
    map.on('click', CASES_SOURCE, e => {
      const id = e.features?.[0]?.properties?.id;
      if (id) window.parent.postMessage({ type: 'dialevac:open-case', id }, '*');
    });
    map.on('mouseenter', CASES_SOURCE, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', CASES_SOURCE, () => { map.getCanvas().style.cursor = ''; });
  }

  // Frame the incident wherever it is, but never pull the view away from a case the dispatcher opened.
  function frameCases(map) {
    if (!cases.length || marker) return;
    const lats = cases.map(c => c.lat), lngs = cases.map(c => c.lng);
    const bounds = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
    const key = bounds.flat().map(n => n.toFixed(2)).join();
    if (key === framedKey) return;
    framedKey = key;
    map.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 0 });
  }

  // A new route frames the whole trip, including over a case the dispatcher already opened.
  function frameRoute(map) {
    if (!route) { framedRoute = undefined; return; }
    const key = route.map(p => `${p.lat},${p.lng}`).join();
    if (key === framedRoute) return;
    framedRoute = key;
    const all = [...route, ...(responder ? [responder] : []), ...(selection ? [selection] : [])];
    const lats = all.map(p => p.lat), lngs = all.map(p => p.lng);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: { top: 64, bottom: 64, left: 64, right: 64 + routeCoveredRight }, maxZoom: 15, duration: window.__dialevacState?.motion ? 900 : 0 });
  }

  // The portal resized this frame, so frame the same content again at the new size.
  function refit() {
    const map = window.__map;
    if (!map || !window.__dialevacState?.ready) return;
    map.resize();
    if (route) { framedRoute = undefined; frameRoute(map); }
    else if (marker) map.jumpTo({ center: marker.getLngLat() });
    else { framedKey = undefined; frameCases(map); }
  }

  // The portal measures the frame before this window has received its new size.
  function whenFrameIs(width, height, run) {
    const deadline = Date.now() + REFIT_WAIT_MS;
    const check = () => {
      const sized = Math.abs(window.innerWidth - width) <= 1 && Math.abs(window.innerHeight - height) <= 1;
      if (sized || Date.now() >= deadline) run();
      else setTimeout(check, 16);
    };
    check();
  }

  function render() {
    const map = window.__map;
    if (!map || !window.__dialevacState?.ready) return;
    addDim(map);
    if (!map.getSource(CASES_SOURCE)) addLayers(map);
    map.getSource(ZONE_SOURCE).setData(zone);
    map.getSource(ROUTE_SOURCE).setData(routeGeoJson());
    map.getSource(CASES_SOURCE).setData(casesGeoJson());
    showResponder(map);
    frameCases(map);
    frameRoute(map);
  }

  const validCase = c => validSelection(c) && typeof c.id === 'string';
  const validPoint = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  const validRoute = points => Array.isArray(points) && points.length >= 2 && points.every(validPoint);

  function parseZone(text) {
    try {
      const geometry = JSON.parse(text);
      return ['Polygon', 'MultiPolygon'].includes(geometry?.type) && Array.isArray(geometry.coordinates) ? { type: 'Feature', properties: {}, geometry } : EMPTY;
    } catch { return EMPTY; }
  }

  window.addEventListener('message', e => {
    if (e.source !== window.parent) return;
    if (e.data?.type === 'dialevac:cases' && Array.isArray(e.data.cases)) {
      cases = e.data.cases.filter(validCase);
      render();
    } else if (e.data?.type === 'dialevac:route') {
      route = validRoute(e.data.points) ? e.data.points : null;
      responder = validSelection(e.data.origin) ? e.data.origin : null;
      routeCoveredRight = Number.isFinite(e.data.coveredRight) ? Math.max(0, e.data.coveredRight) : 0;
      render();
    } else if (e.data?.type === 'dialevac:zone') {
      zone = typeof e.data.geometry === 'string' ? parseZone(e.data.geometry) : EMPTY;
      render();
    } else if (e.data?.type === 'dialevac:select') {
      selection = validSelection(e.data.selection) ? e.data.selection : null;
      if (!selection) clearSelection();
      else if (window.__map && window.__dialevacState?.ready) showSelection(selection);
    } else if (e.data?.type === 'dialevac:refit' && Number.isFinite(e.data.width) && Number.isFinite(e.data.height)) {
      whenFrameIs(e.data.width, e.data.height, refit);
    }
  });

  // After a click on the map the keyboard belongs to this frame, so the portal never sees Escape itself.
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.parent.postMessage({ type: 'dialevac:escape' }, '*');
  });

  // The portal is dark at any hour, so skip the map's sun-based light mode. This runs before app.js boots.
  window.addEventListener('DOMContentLoaded', () => {
    state.pref = 'night';
    // The standalone page's homes are fictional. Here the dots are the portal's real cases.
    for (const data of [HH_PTS, FP_FC, FP_BIG]) data.features.length = 0;
  });

  // The expanded attribution covers the bottom of a small frame. Collapsed, it is still one click away.
  const announceReady = () => {
      if (!window.__map || !window.__dialevacState?.ready) return;
      const version = window.__dialevacState.styleVersion ?? 0;
      if (readyVersion === version && window.__map.getSource(CASES_SOURCE)) return;
      readyVersion = version;
      document.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
      if (selection) showSelection(selection);
      render();
      window.parent.postMessage({ type: 'dialevac:ready' }, '*');
  };
  window.addEventListener('dialevac:map-ready', announceReady);
  window.addEventListener('load', () => {
    window.__map?.once('load', announceReady);
    announceReady();
  });

  // The hidden panel is the map's only connection status, and this page never reconnects by itself.
  window.addEventListener('DOMContentLoaded', () => {
    const offline = document.createElement('div');
    offline.className = 'embed-offline';
    offline.setAttribute('role', 'alert');
    offline.textContent = 'Map data is offline. Warnings and fleet positions may be out of date. Reload the page to reconnect.';
    document.body.append(offline);
    const render = () => { offline.hidden = window.DIALEVAC?.snapshot().state !== 'error' && !!window.DIALEVAC; };
    window.DIALEVAC?.subscribeStatus(render);
    render();
  });
})();
