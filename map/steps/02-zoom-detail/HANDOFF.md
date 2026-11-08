# Step 2: more detail when zoomed in

All of this is in `buildStyle()` (`assets/style.js`). The helper `zf(z0, z1, a, b)` builds a linear zoom interpolate.

| Zoom | What appears |
|---|---|
| ≥ 12.5 | `contour` line layer (major lines thicker). The source thresholds tighten with zoom: `{11: [10, 50], 12: [5, 25], 13: [2, 10], 14: [1, 5], 15: [1, 5]}` (minor and major interval, m). |
| ≥ 13 | `contour-label`: `ele + ' m'` on major lines (`level > 0`). |
| < 15 | `relief`: 4 m colour bands with dark rims. Opacity `zf(14, 15, 1, 0)`. |
| ≥ 13.8 | `relief-fine`: **1 m bands**. Opacity `zf(14, 15, 0, 1)`, so it cross-fades with `relief`. |
| all | `hillshade` (multidirectional, from a separate `demHill` source) and `waterway-glow`. |
| ≥ 14.8 | `bldg-3d`: OSM buildings extruded by `render_height`. `fp-3d`: household footprints (enlarged 1.12×), extruded by status (urgent 12 m, unreached 10.5, assigned 9.5, resolved 8). |
| ≤ 16 | `hh-dot`: household dots, fading out over z15.2–16 as the 3D footprints take over. |
| ≥ 15.8 | `hh-label`: `"<id> · <n> ppl"`. |

## Details
- **DEM:** AWS Terrarium tiles `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (USGS 3DEP in the US), maxzoom 15.
  - The same source object is registered twice, as `demRelief` and `demHill`, so hillshade and color-relief each get their own source (MapLibre's recommendation for raster-dem).
- **Contours:**
  - `new mlcontour.DemSource({url, encoding: 'terrarium', maxzoom: 14, worker: true})`, then `.setupMaplibre(maplibregl)`, then `contourProtocolUrl({thresholds, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours'})`.
  - Needs the `maplibre-contour@0.1.0` UMD script before `style.js`.
- **`bands(stops, from, to, step, rimK, rimW)`:**
  - Builds a stepped `color-relief` ramp: each band is a flat colour, with a darker rim of width `rimW` at its top edge.
  - **Gotcha:** when `rimW = 0` only `v, c, v + step − 0.08, c` may be pushed. Duplicate stops throw "Input/output pairs for interpolate expressions must be arranged with input values in strictly ascending order".
- **Flood-linked status** (an explicit user ask: flood shown only where it happens):
  - Each household gets `hand` from `FLOOD_HAND` (steps/03).
  - `floodStatus`: hand ≤ 2.5 m → `urgent`. Hand ≤ 4 m and `resolved` → `unreached`. Otherwise the synthetic status stays.
  - Use `typeof FLOOD_HAND !== 'undefined'`, not `window.FLOOD_HAND`: a top-level `const` is not a window property.

Verified: at z16, 3 contour layers, 2 contour-label layers and 12 household labels rendered. Day mode at z16 also looks right.
