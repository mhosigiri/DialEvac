# Floodplain map

The DialEvac map. Plain HTML and scripts with MapLibre: no build step to view it.

```bash
cd map && python3 tools/serve.py
```

Open http://127.0.0.1:4178. Live data comes from `hackutd-535md` on Maincloud and the demos from the local database `hackutd-richardson`. Use `?uri=...&db=...` for the live database and `?demoUri=...&demoDb=...` for the demo one.

## Layers

| Layer | Source | Notes |
| --- | --- | --- |
| Live tornado warnings | `zone` table (NWS, polled by the module) | Red polygon per active warning. Click it, or its row in the panel, for the headline, area, issue and expiry times, and the official link. A warning without a polygon is listed, not drawn. Expired warnings are hidden. |
| Feed health | `feed_health` table | Tells "No active tornado warnings" apart from "Unable to refresh warnings". Stale after 6 minutes without a successful poll. |
| Run Demo | Local demo database | Richardson Tornado and Hurricane Aftermath, drawn on their own layers. Live overlays leave the map during a demo; Return to Live restores them. |
| Response vehicles | `vehicle` and `assignment` tables | Available, Assigned (offered, waiting for the driver) or En route (driver accepted). Simulated units carry "SIM". Driver names are not shown. |
| Weather layers | FEMA NFHL, NEXRAD, NHC | Flood zones, radar and active hurricanes from official services. Optional IEM radar overlay. |

The live connection subscribes to `zone`, `feed_health`, `vehicle` and `assignment` only. The local demo connection also reads simulated `household`, `request`, `shelter`, `callback` and `road_closure` rows.

## Live data code

`assets/hazard-tornado.js` draws the layers. `assets/spacetime.js` is built from `src/spacetime.ts` and is not committed. Build it after pulling or after a schema change:

```bash
cd map && npm install && npm run generate && npm run build
```

```bash
cd map && npm test
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
