# The Worst Day, at Scale

The groundwork for an emergency response line, built for State Farm's HackUTD prompt:

> When a major disaster affects thousands of people simultaneously, how might we use AI and technology to identify those with the most urgent needs, coordinate assistance, and ensure no one is overlooked?

A hazard warning puts homes in a zone. The system texts and calls each home, learns who needs a ride and what kind, and dispatches vehicles. It tells every resident only what is true. Each part of the prompt has one home in the code:

| The prompt asks | Where it lives |
| --- | --- |
| Identify those with the most urgent needs | `spacetimedb/src/domain/urgency.ts` ranks every home. Time left before the hazard comes first, then whether they can leave on their own (mobility, oxygen, household size), then a 0-1 prior from records before anyone has been asked. Every survey call carries that rank, and the voice service places the highest first. |
| Coordinate assistance | Ride requests, offers, driver accepts, re-plans on road closures and record corrections, and status callbacks (`plans.ts`, `offers.ts`, `dispatch.ts`). Requests are served earliest deadline first. |
| Ensure no one is overlooked | `spacetimedb/src/domain/coverage.ts` puts every home in the zone in exactly one account. Every 30 seconds a sweep recounts them into the `coverage` table and puts any home nobody is reaching back on the ladder. Picking up the phone is not being reached: a home counts once a record says whether it can leave. |

The architecture comes from Standard-Response, with three changes:

- SpacetimeDB holds all state and runs all logic, in place of Convex.
- Photon carries the text fallback and status callbacks over iMessage, through its Beta REST API.
- An in-module procedure polls National Weather Service alerts, in place of Apify. It needs no key.

The live map in `web/` subscribes to the `vehicle` table.

## Layout

| Folder | What it holds |
| --- | --- |
| `spacetimedb/` | The module: tables, reducers, scheduled jobs, and the rules every client depends on. |
| `services/` | Two Node processes that talk to the outside world. `voice.ts` places calls from the Photon number, where an ElevenLabs agent talks with each resident, and takes the results back by webhook. Residents can also call the Photon number; the same agent answers, and the call is matched to their home by caller number. `messaging.ts` sends and receives Photon messages. |
| `dispatch/` | The Python route solver (OR-Tools), served over HTTP. The module falls back to a built-in heuristic when it is not configured or does not answer. |
| `dispatchers-portal/` | EOC Incident Commander & Dispatcher dashboard (React + Leaflet + Tailwind): real-time SpacetimeDB subscriptions, live emergency triage feed with AI summaries, closest-capable dispatcher proximity graph matching, and call transcript viewer. |
| `web/` | Legacy prototype map. |

## How a night runs

1. `issueWarning` (or a Severe or Extreme NWS alert polygon) marks homes in the zone and starts each home's reach ladder. Every home gets a survey text at once, since texts go out in parallel. Then comes a call, a retry at 2 minutes and another at 5, then the door-check list for field teams. Calls are paced, so a step waits while the home's last call is still queued. A home still unreached 25 minutes before its hazard goes to door checks without waiting.
2. A survey answer by keypad or text reply updates the household. That opens a ride request with the household's needs: mobility, crew size, lift, oxygen and a deadline from the hazard.
3. `replan` runs every 5 seconds and whenever a road closes. It builds the problem from live tables, asks the solver, and writes a plan. An accepted run is frozen; the planner can only add stops after it.
4. A driver accepts or declines the offer. Offers expire after 2 minutes. Accepting moves the request to `driver_accepted`. That queues one callback and one Photon message, keyed so a retry never sends two.
5. Corrections are logged. When a correction makes an accepted vehicle unfit, the assignment is revoked and the resident is told. An offer the driver never accepted ends silently.

Every line a resident hears or reads comes from a template in `spacetimedb/src/domain/honesty.ts`, chosen by the request's status. Generated text never decides what is promised.

Stand-ins cover the parts without real inputs yet. They are on by default and switched off with `setStandIns`. Simulated homes (555 numbers) answer their own calls, simulated drivers accept after 6 seconds, and vehicles drive in straight lines. The services never contact a 555 number.

## Setup

Install the SpacetimeDB CLI yourself (https://spacetimedb.com/install), then:

```bash
cp .env.example .env
```

```bash
cd spacetimedb && npm install && npm test
```

```bash
spacetime start
```

```bash
spacetime login
spacetime publish hackutd-535md --module-path spacetimedb --server maincloud --yes=remote
```

Confirm the contract tables exist:

```bash
spacetime describe hackutd-535md --server maincloud
spacetime sql hackutd-535md --server maincloud "SELECT COUNT(*) FROM vehicle"
spacetime sql hackutd-535md --server maincloud "SELECT COUNT(*) FROM request"
spacetime sql hackutd-535md --server maincloud "SELECT COUNT(*) FROM assignment"
```

Local publish (for the map and services) still uses `hackutd`:

```bash
spacetime publish hackutd --module-path spacetimedb --server local -y
spacetime call hackutd seed_tornado_demo --server local --anonymous
```

The module's own settings (`SOLVER_URL`, `SOLVER_TOKEN`, `FEED_AREA`) are declared in `spacetimedb/src/schema.ts` and installed at publish time, not read from `.env`. `spacetime publish --help` lists how to pass them. Leaving them out is fine: the module plans with its heuristic and the feed stays off.

Generate the client bindings the services and map use, then run each service:

```bash
cd services && npm install && npm run generate
```

```bash
cd web && npm install && npm run generate && npm run dev
```

The shared project database is `hackutd-535md` on Maincloud. The services connect using `SPACETIME_URI` and `SPACETIME_DATABASE` in the root `.env`; `.env.example` contains the shared target. For the map, copy `web/.env.example` to `web/.env.local` before starting Vite. You can also select the shared database with `http://localhost:5173/?uri=wss://maincloud.spacetimedb.com&db=hackutd-535md`. Open two tabs: both subscribe once and key markers by `vehicle.id`. To use a local database, set the service and map environment files to `ws://127.0.0.1:3000` and `hackutd`.

```bash
cd services && npm run messaging
```

Calls need a public HTTPS address for the voice service (`VOICE_PUBLIC_URL`, a tunnel to port 8080 works), the Photon SIP values, and `ELEVENLABS_API_KEY`. Set the Photon voice profile's digest algorithm to SHA-256, then let the setup script create the ElevenLabs webhook, agent and imported number. It writes their IDs to `.env`, and rerunning it updates rather than duplicates. For incoming calls, set the Photon profile's inbound destination to `sips:sip.rtc.elevenlabs.io:5061` (TLS, no credentials):

```bash
cd services && npm run setup:elevenlabs
```

```bash
cd services && npm run voice
```

Run the solver:

```bash
cd dispatch && uv run --with pytest pytest tests
```

```bash
cd dispatch && uv run python server.py
```

## Checks

| Command | What it proves |
| --- | --- |
| `cd spacetimedb && npm test` | The contract: status moves, compatibility, frozen runs, one live offer, idempotent callbacks, correction handling, solver fallback, road closures, Photon replies, keypad digits, incoming calls and NWS zones. Also urgency ranking, coverage, and a 75-minute night of 2,000 homes at 1 call per second. Runs in SpacetimeDB's own test harness. |
| `cd services && npm test` | Photon delivery respects the allowlist, a Photon send reuses the resident's shared line, replies are read once across pages, ElevenLabs signatures validate, a spoken answer is recorded like a pressed key, an incoming call is matched by caller number, a call with no clear answer is not counted as reached, and the call queue places the most urgent call first. |
| `cd services && npm run typecheck` | Needs `npm run generate` first. |
| `cd dispatch && uv run --with pytest pytest tests` | The solver's routes are feasible. |

## At scale

The night test plays the scheduler and a voice service limited to 1 call per second. It runs 2,000 stand-in homes, with hazards arriving 25 to 67 minutes after the warning. At the end every home is accounted for, and none is overlooked or still waiting on the ladder. Calling in urgency order reached 91% of the homes that can't leave on their own by phone. Calling in arrival order reached 87%. A second seed gave 88% and 83%. The cost is that walkers are called later, so slightly more of them go to door checks (356 against 343 on the second seed). The call rate matters more than the order: 2,000 homes at 1 call per second take 33 minutes for one round. At 3 calls per second, even arrival order reached 93% and cut door checks from 317 to 142 (first seed). Raise `VOICE_CALLS_PER_SECOND` as far as the Photon line and ElevenLabs plan allow.

The 4 stand-in vehicles serve about 50 of 800 ride requests in that night. That is the stand-in fleet, not a limit of the dispatcher.

## Not built yet

- Spanish calls. The ElevenLabs agent speaks English only for now.
- A road graph. Drive times are straight-line distance with a detour factor, and a closure blocks any leg passing within 150 m.
- A production map (the `web/` client is the tornado demo overlay).
