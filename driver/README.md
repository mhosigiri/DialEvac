# DialEvac Driver App | Emergency Responder Mobile Companion

A dedicated mobile-first web app for in-vehicle emergency responders and evacuation drivers, connected directly to SpacetimeDB in real-time.

## Features

1. **Live Dispatch Offers (`⚡ Live Offers`)**
   - Instant real-time alerts when dispatchers or automated solvers assign an evacuation trip to this vehicle.
   - High-urgency countdown timer before offer expiration.
   - Immediate visibility into passenger headcount, wheelchair/stretcher accessibility needs, and assistance flags.
   - Giant, one-tap **Accept Run** and **Decline** buttons (invoking `acceptOffer` and `declineOffer`).

2. **Assigned Run Lists (`📋 Run List`)**
   - Sequential manifest of all accepted stops ordered by `stopOrder`.
   - Resident contact card with direct click-to-call phone links (`tel:${phone}`).
   - Mobility requirements and shelter destination details.
   - Driver exception handling: "Report Issue / Cancel Stop" with selectable reasons (`cancelByDriver`).

3. **Turn-by-Turn Navigation HUD (`🧭 Turn-by-Turn`)**
   - High-contrast in-dash navigation card displaying the next maneuver (left, right, straight, u-turn, destination), street name, and distance countdown.
   - **Gemini AI Route Clearance Briefing**: verified safety summary avoiding active flood/road closures.
   - Dynamic vector route map showing responder vehicle position, route polyline, waypoints, and hazard closures.
   - Scrollable step-by-step turn directions.
   - **Get directions**: In-app MapLibre street map using OpenStreetMap data, committed OSMnx road geometry, and a Gemini route brief overlay. Turn instructions remain below the map; directions use the assigned vehicle and stored pickup coordinates.

4. **Vehicle Profile Switcher**
   - Tap unit name in top header to switch between responder units (e.g., wheelchair vans, rescue units, ambulances).
   - Shows vehicle capacity, crew count, lift equipment, and live database sync status.

## Design System

Reuses the exact design tokens, dark color palette (`#060607` bg, `#131316` surface, `#8fb0ff` accent, `#3dd68c` success), and typography (`Outfit`) from `dispatchers-portal/`, tailored for mobile touch targets and driving conditions.

## Running Locally

```bash
cd driver
npm run dev
```

Runs on `http://127.0.0.1:3003/`.
