# Step 4: thunderstorm (simulated radar + lightning + rain)

File: `assets/hazard-storm.js`. It defines the global `WX` (radar canvas, screen rain and lightning) and registers the `storm` hazard.

## Radar
- An offscreen canvas, 160 px wide, is used as a MapLibre **canvas source**: `{type: 'canvas', canvas: <id>, animate: true, coordinates: box corners}`. The box is w −97.06, e −96.44, n 33.21, s 32.75.
- **Squall line:** 14 cores along a tilted line plus 4 isolated cells. They move at VX 2.2, VY −0.5 canvas px/s and wrap around (about 110 s per pass).
- **Field:**
  - A Gaussian convective band (width 5.5 px) plus trailing stratiform rain `0.42·exp(dx/32)` behind the line, modulated by value noise.
  - `dBZ = min(66, 60·v^0.75·(0.5 + 0.75·noise))`.
- **Palette:** the NWS reflectivity ramp, 20 dBZ green → 65 dBZ magenta.
- **Pixels must be premultiplied alpha.** MapLibre uploads canvas sources premultiplied; straight alpha gave a gray rectangle.
- **Layers:**
  - `wx-dim`: a world fill after hillshade, so the radar greens don't merge into the terrain greens. Day `#eef3f1` at 0.45, night `#02141a` at 0.42.
  - `radar`: a raster layer at 0.85 opacity, below `hh-shadow`, so households stay on top.

## Lightning
- A strike every 0.35 + 1.0·random s, placed at a random core above 44 dBZ. Each lasts 1.6 s.
- `strike-glow` and `strike-ring` circles (the ring grows) and `strike-bolt` (a symbol using the runtime `bolt` icon, from `styleimagemissing` → `window.makeIcon`).
- The HUD counts strikes in the last 60 s.

## Rain overlay
- `#rain`, a screen-space canvas with streaks.
- Intensity is the radar value at the map centre, or `WX.extraRain` from the hurricane, whichever is larger.
- Static when motion is off.

## Toggle
- If the map is zoomed out below z9, it flies to Richardson at z10.6.
- HUD: "Thunderstorm · max X dBZ · N strikes/min · raining/dry here · simulated radar".
- The flood peak rises to 3.3 m while the storm is on.

## Bugs fixed along the way
| Problem | Fix |
|---|---|
| The first version produced 121 dBZ and giant blobs | Clamp to 66 and use smaller cells |
| Isolated blobs looked fake | Rewritten as a squall line |
| Radar greens blended into the terrain | Added `wx-dim` |
