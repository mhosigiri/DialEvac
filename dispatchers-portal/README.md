# Dispatchers Portal | Emergency Operations Center

Real-time Incident Commander & Dispatcher dashboard connected directly to **SpacetimeDB** over WebSockets.

---

## Capabilities & Architecture

1. **Direct SpacetimeDB Reactive Subscriptions (`spacetimedb/react`):**
   * Subscribes to `household`, `request`, `vehicle`, `assignment`, `call`, `transcript_line`, `message`, `correction`, `call_handoff`, `dispatch_route`, `zone`, and `coverage`. A database without the two newest tables only logs a subscription error for each, and the rest of the portal keeps working.
   * Any change made by the phone agent (Claude / ElevenLabs), route solver, or field units updates the UI instantaneously.

2. **Server rules, not copies of them (`src/lib/cases.ts`):**
   * Each household becomes one `CaseRow`, built from the module's own compatibility, coverage and urgency functions, so "closest capable unit" means what `writePlan` will accept.
   * The row names the one action that is valid now, and a closed case has none.

3. **Coverage header:** the coverage sweep's accounts (reaching, help requested, door check, cleared, overlooked). Every home in the zone is in exactly one. A **Door checks** tab lists the homes that need a field team.

4. **Live map (embedded `map/`):** the portal owns no map tiles, polygons or markers. The map card embeds the existing MapLibre globe in `map/` (terrain, live NWS warnings, fleet) in an iframe pointed at the same database via `?uri=&db=&embed=1`. Embed mode (`map/assets/embed.js`) hides the map's own controls and fictional homes, shows a banner if its data connection drops, dims the terrain to suit the dark portal, plots the portal's cases and incident zone, frames them, pins the selected one, and draws its road route once one is ready. All of these arrive by `postMessage`, and clicking a dot opens that case. **Full screen** expands the same frame over the portal, so the cases, zone and route stay on it; Esc closes an open case first, then exits. Override the frame with `VITE_MAP_URL`; serve the map with `cd map && npm run serve`.

5. **Case file:** selecting a case opens a side panel with its location, hazard, assistance needs, rescue resources, contact attempts, record changes and call transcript, plus the action that is valid now. It also shows the road route, the resident notice and the human handoff. A route is requested per assignment from OSRM. Accepting an offer already queues the "we're coming" text, so the panel shows its delivery state and offers a button only if none exists. The phone agent starts a transfer, not a dispatcher click, and the panel does not claim a transfer connected without evidence from the carrier. It reads the live tables, so it updates during a call without being reopened. The queue stays usable beside it. Simulated homes have no transcript.

6. **Queue board:** the Queue view shows every case in five columns by what it is waiting on. The Overview view keeps the chart, a shorter queue, the map and the fleet.
7. **Queue filters:** the panel beside the board applies one filter at a time. Views read case fields and hazards come from `catastrophe_case`. Mine lists cases this browser acted on, stored locally, because no table records which dispatcher owns a case. Each column's menu sorts, opens its top case and exports it. Exports neutralize spreadsheet formulas, so a phone number starts with an apostrophe.

7. **Dispatch workflow:** `proposePlan`, `approveOffer`, `acceptOffer`, `declineOffer`, `closeRequest`, `notifyResident`, and `requestDispatchRoute`. A rejected action shows a notice. Actions pause while the connection is down, and the last known cases stay on screen under a warning until it reconnects.

---

## Operator access

Reducers only accept identities listed in the module's `OPERATOR_IDENTITIES`. Anyone can read without a grant. The portal keeps one token per server and database in this browser's `localStorage`, so its identity stays the same between visits. Copy the identity from the top right of the portal and have a publisher add it, as `services/AUTHORIZATION.md` describes. Until then, an action shows a "not authorized" banner and changes nothing.

---

## Local Development

```bash
cd dispatchers-portal
cp .env.example .env
npm install
npm run generate
npm run dev
```

Server runs on: **`http://localhost:3001`**
Connected to SpacetimeDB: **`wss://maincloud.spacetimedb.com`** (Database: `hackutd-535md`).

The default URI and database are shared with the services and public map through `shared/spacetime.ts`. `VITE_SPACETIME_URI` and `VITE_SPACETIME_DATABASE` in `.env` can override them. Household transcripts are joined through the household's call IDs. Run `cd services && npm run check:connections` from the repository root to verify all application table subscriptions.
