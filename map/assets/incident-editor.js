'use strict';
(() => {
  if (!new URLSearchParams(location.search).has('embed')) return;
  const SOURCE = 'incident-editor-draft', CLOSURES = 'incident-editor-closures';
  let mode = 'none', vertices = [], closures = [], bound;
  const valid = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  function render() {
    const map = window.__map;
    if (!map || !window.__dialevacState?.ready) return;
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: SOURCE + '-fill', type: 'fill', source: SOURCE, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#8fb0ff', 'fill-opacity': .2 } });
      map.addLayer({ id: SOURCE + '-line', type: 'line', source: SOURCE, filter: ['!=', '$type', 'Point'], paint: { 'line-color': '#b8cfff', 'line-width': 3 } });
      map.addLayer({ id: SOURCE + '-corners', type: 'circle', source: SOURCE, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#f5f5f6', 'circle-stroke-color': '#5878c5', 'circle-stroke-width': 2 } });
      map.addSource(CLOSURES, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: CLOSURES, type: 'circle', source: CLOSURES, paint: { 'circle-radius': 9, 'circle-color': '#f87171', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    }
    const coordinates = vertices.map(p => [p.lng, p.lat]);
    const features = coordinates.map(p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
    if (coordinates.length >= 3) features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] } });
    else if (coordinates.length === 2) features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
    map.getSource(SOURCE).setData({ type: 'FeatureCollection', features });
    map.getSource(CLOSURES).setData({ type: 'FeatureCollection', features: closures.map(c => ({ type: 'Feature', properties: { street: c.street }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })) });
    map.getCanvas().style.cursor = mode === 'none' ? '' : 'crosshair';
    if (mode === 'zone') map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    if (bound === map) return;
    bound = map;
    map.on('click', event => {
      if (mode === 'none') return;
      const point = { lat: event.lngLat.lat, lng: event.lngLat.lng };
      if (valid(point)) window.parent.postMessage({ type: 'dialevac:incident-point', mode, point }, '*');
    });
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'dialevac:incident-editor') return;
    if (!['none', 'zone', 'closure'].includes(event.data.mode)) return;
    mode = event.data.mode;
    vertices = Array.isArray(event.data.vertices) ? event.data.vertices.filter(valid).slice(0, 500) : [];
    closures = Array.isArray(event.data.closures) ? event.data.closures.filter(valid).slice(0, 2000) : [];
    render();
  });
  window.addEventListener('dialevac:map-ready', render);
})();
