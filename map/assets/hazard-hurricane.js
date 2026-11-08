// Hazard: active tropical cyclones from the National Hurricane Center (via NOAA's map service): the
// cone of uncertainty, past and forecast track, and forecast points, for every active Atlantic,
// East Pacific and Central Pacific storm. Refreshed every 10 minutes.
'use strict';
(() => {
  const SERVICE = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
  // Each storm slot (AT1-5, EP1-5, CP1-5) has its forecast points layer here; track, cone and past track follow at +1, +2, +6.
  const SLOTS = [6, 32, 58, 84, 110, 136, 162, 188, 214, 240, 266, 292, 318, 344, 370];
  const REFRESH_MS = 10 * 60 * 1000;
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  let data = empty(), storms = [], status = 'loading';

  const query = async id => {
    const r = await fetch(`${SERVICE}/${id}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`NHC answered ${r.status}`);
    return (await r.json()).features || [];
  };
  const tag = (features, k) => features.map(f => ({ ...f, properties: { ...f.properties, k } }));

  async function refresh() {
    try {
      const points = await Promise.all(SLOTS.map(query));
      const features = [], found = [];
      await Promise.all(SLOTS.map(async (id, i) => {
        if (!points[i].length) return;
        const [track, cone, past] = await Promise.all([query(id + 1), query(id + 2), query(id + 6)]);
        features.push(...tag(cone, 'cone'), ...tag(past, 'past'), ...tag(track, 'fut'));
        const pts = points[i].sort((a, b) => a.properties.tau - b.properties.tau);
        const now = pts[0].properties;
        found.push({ name: now.stormname, wind: now.maxwind, type: now.stormtype, adv: now.advdate, at: pts[0].geometry.coordinates });
        for (const p of pts) {
          const q = p.properties;
          features.push({ type: 'Feature', geometry: p.geometry, properties: {
            k: 'pt', now: q.tau === 0 ? 1 : 0, cat: q.stormtype,
            label: q.tau === 0 ? `${q.stormname} · ${q.maxwind} kt` : q.datelbl } });
        }
      }));
      data = { type: 'FeatureCollection', features };
      storms = found;
      status = 'ok';
      const src = window.__map && window.__map.getSource('track');
      if (src) src.setData(data);
    } catch { status = 'failed'; }
  }
  refresh();
  setInterval(refresh, REFRESH_MS);

  const prevIcon = window.makeIcon;
  window.makeIcon = id => {
    if (id !== 'hurricane') return prevIcon ? prevIcon(id) : null;
    const S = 56, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
    x.translate(S / 2, S / 2); x.fillStyle = '#ff2d55'; x.strokeStyle = '#ffffff'; x.lineWidth = 3;
    for (const k of [0, Math.PI]) { x.save(); x.rotate(k); x.beginPath(); x.moveTo(0, -6); x.quadraticCurveTo(14, -24, -4, -26); x.quadraticCurveTo(8, -16, -6, -6); x.closePath(); x.fill(); x.stroke(); x.restore(); }
    x.beginPath(); x.arc(0, 0, 9, 0, 7); x.fill(); x.stroke(); x.beginPath(); x.arc(0, 0, 3.5, 0, 7); x.fillStyle = '#ffffff'; x.fill();
    const d = x.getImageData(0, 0, S, S); return { img: { width: S, height: S, data: new Uint8Array(d.data.buffer) }, opts: { pixelRatio: 2 } };
  };

  HAZARDS.push({
    id: 'hurricane', label: 'Hurricanes', note: 'NHC active', defaultOn: true,
    addTo(s, m) {
      const ink = m === 'day' ? '#14302f' : '#ffffff', halo = m === 'day' ? 'rgba(255,253,245,.92)' : 'rgba(4,20,26,.9)';
      s.sources.track = { type: 'geojson', data, attribution: 'Storms: <a href="https://www.nhc.noaa.gov/">NOAA National Hurricane Center</a>' };
      s.layers.splice(s.layers.findIndex(l => l.id === 'hh-shadow'), 0,
        { id: 'cone', type: 'fill', source: 'track', filter: ['==', ['get', 'k'], 'cone'], paint: { 'fill-color': '#ffffff', 'fill-opacity': m === 'day' ? 0.35 : 0.1 } },
        { id: 'cone-edge', type: 'line', source: 'track', filter: ['==', ['get', 'k'], 'cone'], paint: { 'line-color': ink, 'line-opacity': 0.55, 'line-width': 1.2, 'line-dasharray': [2, 2] } },
        { id: 'track-past', type: 'line', source: 'track', filter: ['==', ['get', 'k'], 'past'], paint: { 'line-color': ink, 'line-width': 2, 'line-opacity': 0.8 } },
        { id: 'track-fut', type: 'line', source: 'track', filter: ['==', ['get', 'k'], 'fut'], paint: { 'line-color': ink, 'line-width': 2.4, 'line-dasharray': [1.5, 1.2] } });
      s.layers.push(
        { id: 'track-pt', type: 'circle', source: 'track', filter: ['all', ['==', ['get', 'k'], 'pt'], ['!=', ['get', 'now'], 1]], paint: {
          'circle-radius': 5, 'circle-color': ['match', ['get', 'cat'], ['HU', 'MH'], '#ff2d55', ['TS', 'STS'], '#ffb000', ink], 'circle-stroke-color': halo, 'circle-stroke-width': 1.5 } },
        { id: 'eye-icon', type: 'symbol', source: 'track', filter: ['==', ['get', 'now'], 1], layout: { 'icon-image': 'hurricane', 'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.1], 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map', 'icon-rotate': 0 } },
        { id: 'track-label', type: 'symbol', source: 'track', filter: ['all', ['==', ['get', 'k'], 'pt'], ['has', 'label']], minzoom: 3.5, layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-letter-spacing': 0.06, 'text-anchor': 'left', 'text-offset': [1.2, 0], 'text-allow-overlap': false },
          paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6 } });
    },
    toggled(map, on) {
      if (!on || !storms.length) return;
      const b = new maplibregl.LngLatBounds();
      for (const f of data.features) if (f.properties.k === 'cone' || f.properties.k === 'pt') (f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates.flat(f.geometry.type === 'Polygon' ? 1 : 2)).forEach(c => b.extend(c));
      if (!b.isEmpty()) map.fitBounds(b, { padding: 80, maxZoom: 6, duration: 3000 });
    },
    tick(map, t, dt, st) {
      if (st.motion && map.getLayer('eye-icon')) map.setLayoutProperty('eye-icon', 'icon-rotate', (-t * 40) % 360);
      if (status === 'loading') return 'Hurricanes · loading NHC storms…';
      if (status === 'failed' && !storms.length) return 'Hurricanes · unable to load NHC storms';
      if (!storms.length) return 'Hurricanes · no active tropical cyclones (NHC)';
      return 'NHC · ' + storms.map(s => `${s.name} ${s.wind} kt`).join(' · ') + ` · advisory ${storms[0].adv}`;
    },
  });
})();
