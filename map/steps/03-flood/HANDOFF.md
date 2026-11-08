# Step 3: flood drawn only where it floods (HAND model)

**Goal:** water appears only along real creeks, rising and falling. It must never wash over the whole map.

## Method: Height Above Nearest Drainage
`tools/build_flood.py`; the docstring has the full method.

1. **Area:** S, W, N, E = 32.93, −96.82, 33.03, −96.68. That gives z14 tiles x 3784–3791 × y 6596–6603, rounded out to multiples of 4 so z13 and z12 come from exact 2×2 means.
2. **DEM:** Terrarium z14 tiles (about 8 m/px), decoded as `R·256 + G + B/256 − 32768`.
3. **Creeks:** Overpass query for `waterway ~ stream|river|canal|drain|ditch` in the area ± 0.02°, cached as `waterways.json`.
   - **Keep only `stream`/`river` that have a `name` and no `tunnel` tag** (105 ways).
   - With all 700+ ways (ditches, drains, culverts), 45 km² flooded. Unusable.
   - The kept ways are rasterised onto the DEM grid.
4. **Channel bottom** = 5×5 `minimum_filter` of the DEM, so a slightly misplaced OSM line still finds the channel.
5. `distance_transform_edt(~stream, return_indices=True)` gives each pixel's nearest creek pixel. Then:
   - `HAND = dem − chan[nearest]`, clipped to 0–59.
   - **Pixels more than 450 m from a creek get 60**, so they can never flood.
   - `gaussian_filter(σ = 0.8)` smooths the shorelines.
6. HAND is written as Terrarium PNGs to `tiles/flood/{14,13,12}/x/y.png`: 84 tiles, about 2.5 MB.
7. It also writes `assets/flood.js`:
   - `FLOOD_BOUNDS`: the tile extent **inset by 0.002°**. Without the inset, MapLibre requested edge tiles that don't exist and logged 404s.
   - `FLOOD_HAND`: HAND sampled at each household.

Run it (needs numpy, scipy and Pillow, plus network access on the first run):
```
cd outputs/floodplain-map
python3 tools/build_flood.py <cache_dir>      # cache_dir holds DEM tiles + waterways.json; defaults to ./.cache
```
Actual output from the run used here:
- HAND ≤ 2 m covers 16.6 km².
- Households: 9 at ≤ 2 m and 18 at ≤ 4 m.
- 84 tiles written.

## Rendering (`assets/hazard-flood.js`)
- **Source:** `flood`, a raster-dem with `encoding: 'terrarium'`, minzoom 12, maxzoom 14, `bounds: FLOOD_BOUNDS`, and a URL built from `location.href`.
- **Layer:** `flood`, a `color-relief` inserted right after `hillshade`. Minzoom 11.5, with opacity fading in over z11.5–12.3.
  - Colour ramp over HAND for water level L: `-1 → deep`, `max(L − 0.7, −0.5) → mid`, `L → shore` (bright foam edge), `L + 0.22 → transparent`, `100 → transparent`.
  - So only ground lower than L above its creek is painted.
- **`hh-wet`:** a ring around households whose `hand < L`, placed below `hh-shadow`.
- **Animation (`tick`):**
  - `L = 0.2 + (peak − 0.2)·(0.5 − 0.5·cos(2πt/24))`, a 24 s rise-and-fall cycle.
  - `peak` is 2.8 m, 3.3 m with the thunderstorm on, and 4.2 m with the hurricane on.
  - With motion off, L stays at `peak × 0.75`.
  - The paint property is only reset when L changes by more than 2 cm; the filter only when L/10 changes.
- **HUD:** "Creek flood · water X m above creek beds · N homes in water · illustrative".

## Limits
- This is a terrain proxy, not hydraulics: no flow routing, culverts, levees or rainfall amounts.
- Unnamed ditches don't flood.
- Coverage is the bounding box only. The flood is not drawn outside it, by design.
