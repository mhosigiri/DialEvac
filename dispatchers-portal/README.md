# Dispatchers Portal | Emergency Operations Center

Real-time Incident Commander & Dispatcher dashboard connected directly to **SpacetimeDB** over WebSockets.

---

## Capabilities & Architecture

1. **Direct SpacetimeDB Reactive Subscriptions (`spacetimedb/react`):**
   * Subscribes to `household`, `request`, `vehicle`, `assignment`, `call`, `transcript_line`, `zone`, and `coverage`.
   * Any change made by the phone agent (Claude / ElevenLabs), route solver, or field units updates the UI instantaneously.

2. **Bipartite Dispatch Graph & Proximity Matching:**
   * Computes Haversine distance and disaster response ETA between every open victim household and the rescue fleet.
   * Enforces physical vehicle capacity constraints (wheelchair spaces, hydraulic lift, stretcher spaces, 2-person lift crew).
   * Automatically pairs each victim with the **#1 closest capable rescue unit** and draws graph vectors on the map.

3. **Interactive Dark Mode Map (Leaflet):**
   * Renders the active disaster hazard zone polygon.
   * Color-codes victim pins by urgency:
     * 🚨 **Critical** (Pulsing Red): Continuous oxygen dependency / bedbound stretcher needed.
     * 🔶 **High** (Amber): Wheelchair evacuation required.
     * 🔵 **Standard** (Sky): Ambulatory ride request.
     * 🟢 **Cleared** (Emerald): Self-evacuating or rescued.
   * Displays live rescue vehicle positions with driver names and capacity.
   * Draws active assignment routes (amber/sky lines) and closest-match vectors (dotted cyan).

4. **Turn-by-Turn Call Transcript Inspector:**
   * Click any incident card to view the exact dialogue between the resident and the AI voice agent.

5. **One-Click Dispatch & Mission Workflow:**
   * Direct triggers for `proposePlan`, `approveOffer`, `acceptOffer`, `declineOffer`, and `closeRequest` reducers in SpacetimeDB.

---

## Local Development

```bash
cd dispatchers-portal
npm install
npm run generate
npm run dev
```

Server runs on: **`http://localhost:3001`**
Connected to SpacetimeDB: **`wss://maincloud.spacetimedb.com`** (Database: `hackutd-535md`).
