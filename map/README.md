# Floodplain map

The DialEvac map. Plain HTML and scripts with MapLibre: no build step to view it.

```bash
cd map && python3 tools/serve.py
```

Open http://127.0.0.1:4178. The page connects to the local SpacetimeDB database `hackutd` at `ws://127.0.0.1:3000`. Use `?uri=...&db=...` to point it elsewhere, or `?live=off` to run without live data.

## Layers

| Layer | Source | Notes |
| --- | --- | --- |
| Live tornado warnings | `alert` table (NWS, polled by the module) | Red polygon per active `Tornado Warning`. Click it, or its row in the panel, for the headline, area, issue and expiry times, and the official link. A warning without a polygon is listed, not drawn. Expired warnings are hidden. `?events=all` shows every alert type. |
| Feed health | `feed_status` table | Tells "No active tornado warnings" apart from "Unable to refresh warnings". Stale after 6 minutes without a successful poll. |
| Simulated hazard | `zone` rows with source `stand-in` | Dashed outline labelled SIMULATED. Never styled or listed as a live warning. |
| Response vehicles | `vehicle` and `assignment` tables | Available, Assigned (offered, waiting for the driver) or En route (driver accepted). Simulated units carry "SIM". Driver names are not shown. |
| Illustrations | Static files | Creek flood, thunderstorm and hurricane. Illustrative only. |

The map subscribes to `alert`, `feed_status`, `zone`, `vehicle` and `assignment` only. It never reads household, request, call, message or transcript tables.

## Live data code

`assets/live.js` draws the layers. `assets/live-data.js` is built from `live/src/live-data.ts`. Rebuild it after a schema change:

```bash
cd map/live && npm install && npm run generate && npm run build
```

```bash
cd map/live && npm test
```

## Local data

```bash
spacetime start
```

```bash
FEED_AREA=TX spacetime publish hackutd --module-path spacetimedb --server local --yes
```

```bash
spacetime call hackutd seed_tornado_demo --server local
```

```bash
spacetime call hackutd issue_warning tornado --server local
```

```bash
spacetime call hackutd start_feeds --server local
```
