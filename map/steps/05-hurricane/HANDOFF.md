# Step 5: hurricane (satellite-style storm, cone, track, wind rings)

File: `assets/hazard-hurricane.js`. It defines the global `HURR` and registers the `hurricane` hazard.

## Scenario
This is illustrative and labelled "not a forecast":
- A CAT 3 (115 mph) landfall near Galveston, with the eye at [−95.3, 29.3].
- Forecast points: +12 h CAT 1, then **+36 h tropical storm over Dallas–Richardson**, then +48 h depression.

## Cloud canvas
- A canvas source with box w −102, e −88, n 36.5, s 22.5, **N = 250 px**.
- **Not a power of two.** With 256, MapLibre built mipmaps once and never refreshed them, so the animated texture looked flat gray when zoomed out.
- `ASPECT = 1/cos(29.5°)`: the canvas is equirectangular, so y is stretched to keep the storm round.
- **Cloud model:**
  - Two spiral-arm families with noise.
  - A central dense overcast (r 0.27 of RMAX = 118 px, about 650 km).
  - A bright eyewall at r 0.06, and a clear eye inside r 0.035.
  - The whole field rotates counter-clockwise (`rot += dt·0.12` rad/s), and the canvas is repainted every 0.12 s.
- **Colors:**
  - Night: an enhanced-IR palette, gray-white with colour only on the coldest tops.
  - Day: white clouds.
  - Premultiplied, as for the radar.

## Vector features (GeoJSON `GEO`)
- Forecast cone (fill and dashed edge).
- Past track (solid) and forecast track (dotted).
- Track points with labels: `NOW · CAT 3 · 115 mph` … `+36 h · TS · DALLAS–RICHARDSON`, `+48 h DEPRESSION`.
- Wind rings: 34 kt at 280 km (labelled TROPICAL-STORM WINDS) and 64 kt at 95 km (HURRICANE WINDS).
- A rotating eye icon (runtime icon `hurricane`, which wraps `bolt`'s icon factory).
- It also adds the shared `wx-dim` layer if the storm hasn't already, so the satellite clouds read against the terrain.
- Layers below `hh-shadow`: cone, cone-edge, hurricane raster (0.92), wind-rings, track-past, track-fut.
- Layers on top: track-pt, eye-icon, track-label, ring-label.

## Behaviour
- **On:** flies to [−95.6, 30.9] at z5.15. **Off:** if zoomed out below z9, flies back to `HOME`.
- **Rain:** when zoomed in past z9, rain intensity comes from the cloud density at the map centre. It drives `WX.rain` directly, or `WX.extraRain` when the storm is also on.
- The flood peak rises to 4.2 m.
- HUD: "Hurricane · CAT 3 landfall near Galveston · forecast reaches Richardson as a tropical storm in ~36 h · rain bands here / no rain here · illustrative, not a forecast".

## Projection workaround (important)
- MapLibre 5.6.2's **globe** projection draws a large animated canvas source over everything as a flat rectangle. So `fullStyle()` sets `projection: {type: 'mercator'}` while the hurricane is on.
- `setStyle(..., {diff: true})` **does not apply projection changes**. `restyle()` therefore calls `map.setProjection()` itself.
- That call **throws "Style is not done loading"** right after a diff, so it is retried every 100 ms.
- A projection change **cancels a running flyTo**. Hazard `toggled()` fly-tos therefore run in `restyle(after)`, after the projection has been applied.
