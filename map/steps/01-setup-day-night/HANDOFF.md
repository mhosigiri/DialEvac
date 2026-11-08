# Step 1: scaffold and day/night by the sun

## Scaffold
- Make `outputs/floodplain-map/` and copy from `../map-style-options-v2/`:
  - `assets/vendor/`
  - `assets/base-style.js`, `assets/data.js` and `assets/footprints.js`
  - `tools/serve.py`, with the port changed to **4178**
- Add an `end_headers` override to `serve.py` that sends `Cache-Control: no-store`. Without it, the browser pane kept stale JS between edits. Also silence `log_message`.
- Cache-busting query strings are still used on edited scripts (`app.js?v=3`).

## Palettes (`assets/style.js`)
- `PAL.night` and `PAL.day` share the same keys:
  - `bg`, `water`, `waterway`, `building`, `road`, `roadOpacity`, `label`, `halo`
  - `relief` (elevation stops in m), `rim`, `hill{}`, `glow`, `status{}`, `sky`, `ui{}`, `fx`
  - `contour`, `contourMajor`, `contourLabel`, `bldg`, `bldgOpacity`, `light`
- Night relief runs `#022630` at 160 m → `#06505e` 172 → `#0f7d7a` 182 → `#3aa48a` 190 → `#8cc591` 198 → `#d5dca3` 206 → `#f3e3b0` 214 → `#fff4dc` 226.
  - Low ground is deep teal and ridges glow sand. This is the "X-ray" look.
  - At home zoom the screen is fairly pale, because Richardson sits mostly at 180–215 m. That is intended, not a bug.
- Day relief is a lighter teal → cream ramp (`#4e9f9c` … `#fffaf0`).
- Status colors:
  - Night: urgent `#ff3358`, unreached `#ffb000`, assigned `#8a5cff`, resolved `#e8f1ee`.
  - Day: `#e0173a`, `#e38a00`, `#5a31d6`, `#7d8f8c`.
- `buildStyle(mode)` recolors `BASE_STYLE` layers by id pattern. It sets projection `globe` (MapLibre switches to flat above ~z12), `transition: {duration: 900}`, `sky` with `atmosphere-blend` fading out by z8, and `light`. It also adds the terrain, relief, contour, 3D and household layers (step 2).

## Sun (`assets/sun.js`)
- NOAA algorithm: Julian century → mean longitude and anomaly → equation of centre → declination and equation of time → hour angle → elevation.
- `SUN.nextCrossing(from, lat, lng, alt = -0.833)` walks forward in 5-minute steps, then bisects, up to 48 h. It returns `{time, rising}`.
- **Day means elevation > −0.833°** (standard sunrise/sunset, with refraction and the solar disc).

## Mode logic (`assets/app.js`)
- `state.pref` is `'auto' | 'day' | 'night'`. Auto uses `sunMode()` at LAT/LNG 32.977, −96.758 (Richardson).
- `applyMode(force)`:
  - Sets the CSS variables `--bg --ink --sub --line --accent --bg-solid --fx` from `P.ui`.
  - Rebuilds the legend and updates the `#sun` text, e.g. "Auto: sun −62° → night · sunrise 6:52 AM".
  - Calls `restyle()` only when the mode actually changes.
- `setInterval(() => applyMode(false), 60000)` re-checks the sun every minute, so the map flips by itself at sunrise and sunset.
- `restyle(after)`:
  - `map.setStyle(fullStyle(mode), {diff: true})` gives a smooth 900 ms cross-fade.
  - Then `map.setProjection(...)`, retried every 100 ms until the style has loaded (step 5 explains why).
  - Then the optional `after` callback.
  - `state.ready` gates the animation loop while the style swaps.
- Boot: start on a globe at z1.8, then `flyTo(HOME)` over 6 s. `HOME = {center: [-96.758, 32.977], zoom: 13.55, pitch: 38, bearing: -12}`.

## Motion
- The Motion On/Off toggle defaults to `prefers-reduced-motion` and follows changes to it.
- Off gives static fallbacks:
  - The household pulse is fixed at 0.55.
  - The flood holds at 75 % of its peak.
  - The radar and the hurricane freeze.
  - Rain is static.
