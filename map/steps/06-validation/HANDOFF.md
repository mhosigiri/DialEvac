# Step 6: validation (actual results, Nov 7 2026)

All checks ran live in a browser against `http://127.0.0.1:4178`.
- They ran in a **second tab**, because the user was clicking around in the main tab at the same time.
- They used `window.__map` and `state` from the console, and clicked chips with `document.querySelector('[data-h="…"]').click()`.
- A hash-only URL change does not reload the page; use a new `?r=N` query.

| Check | Result |
|---|---|
| Auto mode at night (local evening) | Night palette; sun text "Auto: sun −66° → night · sunrise 6:51 AM". |
| Day and Night buttons | Both switch with a 900 ms cross-fade; legend and UI colours follow. (`images/home-day.jpg`, `images/home-night.jpg`) |
| Zoom detail | At z16: contours, contour labels and 12 household labels render; 3D footprints from z14.8. |
| Flood | Water follows only the named creeks; the HUD counts homes in water (0 → 18 over a cycle at peak 4.2 m). |
| Thunderstorm | Squall line visible west of Richardson; 51–62 dBZ max, about 1–10 strikes/min depending on where the line is in its pass. |
| Hurricane, night | Enhanced-IR clouds, cone, track labels and both wind rings correct over the Texas coast (`images/hurricane-night.jpg`). Day mode was verified earlier. |
| Hurricane projection | On: `mercator`. Off: back to `globe`. The camera goes 13.55 → 5.15 → 13.55 (fly out and back). |
| All three hazards plus motion off | Everything renders together; the HUD shows all three lines; the animation freezes (`images/all-hazards-night.jpg`). |
| Console | No errors after the final fixes. A one-off MapLibre "reading 'key' at _updateRetainedTiles" seen earlier in the session did not recur. |

## Bugs found and fixed during the build
| Bug | Fix |
|---|---|
| 1 m relief bands threw "interpolate … strictly ascending" | Fixed the rimless branch of `bands()` (steps/02). |
| `window.FLOOD_HAND` was undefined | A top-level `const` is not on `window`; use a `typeof` check. |
| Flood covered 45 km² | Kept only named, open creeks; 450 m reach cap (steps/03). |
| 404s for edge flood tiles | Inset `FLOOD_BOUNDS` by 0.002°. |
| Storm too strong, blobby | Clamped dBZ; rewrote it as a squall line; added `wx-dim`. |
| Hurricane drew as a gray rectangle | Premultiplied alpha, a non-power-of-two canvas (250), and mercator while the hurricane is on (steps/05). |
| Turning the hurricane on broke restyle ("Style is not done loading") | `setProjection` retry loop in `restyle()`. |
| Turning the hurricane off didn't fly home | The projection change cancelled the flyTo; fly-tos now run after the projection is set. |

## Known limits
- **Everything is illustrative:** synthetic households, HAND as a terrain proxy, simulated radar, and a fictional hurricane. The HUD and brand card say so.
- The hurricane forces flat mercator: no globe while it's on. Revisit when MapLibre fixes canvas sources on the globe.
- The flood only exists inside the build bounding box (about 16 × 15 km around Richardson).
- Depends on network tiles: OpenFreeMap, AWS Terrarium, and unpkg for maplibre-contour.
- Not yet integrated into `../haven-map-prototype/`.
