// Hazard: live radar. The NEXRAD base reflectivity mosaic for the US, from the Iowa Environmental
// Mesonet, refreshed every 5 minutes and labelled with the time it was observed.
'use strict';
(() => {
  const TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';
  const META = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json';
  const REFRESH_MS = 5 * 60 * 1000;
  const OLD_MS = 20 * 60 * 1000;
  let observedAt = null, failed = false;
  const tiles = () => [`${TILES}?v=${observedAt ? observedAt.getTime() : 0}`]; // a new time busts the tile cache

  async function refresh() {
    try {
      const r = await fetch(META, { cache: 'no-store' });
      const valid = new Date((await r.json()).meta.valid);
      failed = Number.isNaN(valid.getTime());
      if (failed || (observedAt && valid.getTime() === observedAt.getTime())) return;
      observedAt = valid;
      const src = window.__map && window.__map.getSource('radar');
      if (src && src.setTiles) src.setTiles(tiles());
    } catch { failed = true; }
  }
  refresh();
  setInterval(refresh, REFRESH_MS);

  HAZARDS.push({
    id: 'storm', label: 'Radar', note: 'NEXRAD live', defaultOn: true,
    addTo(s) {
      s.sources.radar = { type: 'raster', tiles: tiles(), tileSize: 256, maxzoom: 10,
        attribution: 'Radar: <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a> (NWS NEXRAD)' };
      beforeSymbols(s, { id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.72, 'raster-resampling': 'linear', 'raster-fade-duration': 300 } });
    },
    tick() {
      if (!observedAt) return failed ? 'Radar · unable to load the radar time' : 'Radar · loading…';
      const t = observedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const age = Date.now() - observedAt.getTime();
      return `NEXRAD radar · observed ${t}${age > OLD_MS ? ` · ${Math.round(age / 60000)} min old` : ''}${failed ? ' · refresh failed' : ''}`;
    },
  });
})();
