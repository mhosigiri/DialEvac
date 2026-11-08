// Hazard: FEMA flood zones. The National Flood Hazard Layer, drawn in the map's own flood blues:
// deep blue for the 1% annual chance (100-year) floodplain, light blue for the 0.2% (500-year) zone.
// FEMA only draws these at street scale (1:36,000 or closer), so the layer starts at zoom 12.
'use strict';
(() => {
  const EXPORT = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export';
  const MIN_ZOOM = 12;
  const COL = {
    night: { sfha: [16, 110, 215, 190], x500: [40, 170, 255, 105] },
    day: { sfha: [8, 84, 180, 170], x500: [28, 140, 232, 95] },
  };
  const fill = (id, where, color) => ({
    id, source: { type: 'mapLayer', mapLayerId: 28 }, definitionExpression: where,
    drawingInfo: { renderer: { type: 'simple', symbol: { type: 'esriSFS', style: 'esriSFSSolid', color, outline: { type: 'esriSLS', style: 'esriSLSNull', color: [0, 0, 0, 0], width: 0 } } } },
  });
  // dpi 24 makes FEMA treat a zoom-12 tile as street scale; the 256 px image is unchanged.
  const tiles = m => {
    const q = new URLSearchParams({
      bboxSR: '3857', imageSR: '3857', size: '256,256', dpi: '24', format: 'png32', transparent: 'true', f: 'image',
      dynamicLayers: JSON.stringify([fill(101, "ZONE_SUBTY LIKE '0.2 PCT%'", COL[m].x500), fill(100, "SFHA_TF = 'T'", COL[m].sfha)]),
    });
    return [`${EXPORT}?bbox={bbox-epsg-3857}&${q}`];
  };
  HAZARDS.push({
    id: 'flood', label: 'Flood zones', note: 'FEMA NFHL', defaultOn: true,
    addTo(s, m) {
      s.sources.flood = { type: 'raster', tiles: tiles(m), tileSize: 256, minzoom: MIN_ZOOM, maxzoom: 18,
        attribution: 'Flood zones: <a href="https://www.fema.gov/flood-maps/national-flood-hazard-layer">FEMA NFHL</a>' };
      const i = s.layers.findIndex(l => l.id === 'hillshade');
      s.layers.splice(i + 1, 0, { id: 'flood', type: 'raster', source: 'flood', minzoom: MIN_ZOOM - 0.5,
        paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM - 0.5, 0, MIN_ZOOM + 0.4, 1], 'raster-fade-duration': 200 } });
    },
    tick(map) {
      return map.getZoom() < MIN_ZOOM - 0.5
        ? 'FEMA flood zones · zoom in to street level to see them'
        : 'FEMA flood zones · dark: 1% annual chance (100-year) · light: 0.2% (500-year)';
    },
  });
})();
