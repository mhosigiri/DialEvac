# Houston single-call demo and portal integration

Table names below are SQL names. Field and reducer names use the generated TypeScript SDK spelling (SQL columns use snake case).

The target is **Maincloud `hackutd-richardson` only**. This integration must not publish to or mutate `hackutd-535md`, change operator grants, or send real calls/messages. The requested transcript fix now runs a receive/archive/analyze service; outbound voice and messaging runners remain disabled. See [CALL_INGESTION.md](CALL_INGESTION.md). Anish owns portal identity grants. The public fixture uses `shared/demo.ts`: a synthetic Houston address, coordinates near Buffalo Bayou, and fictional phone alias. The actual resident and selected human numbers come only from the three-number `.env` allowlist and private generated files.

## Mid-call assessment

`recordCallAssessment({ callId, providerId, choice, people?, oxygen? })` is service-only. A signed per-call agent tool at `POST /elevenlabs/assessment` invokes it during the live survey. The API response is successful only after the reducer commits. Portal subscriptions then receive:

- `household.canLeave`, `mobility`, `assistance`, `people`, `oxygen`, `reach` from confirmed answers.
- The corresponding `request` creation/update and its needs fields, plus `correction` entries for changed recorded values.
- `call.phase = "live"` and the real `call.providerId`.

Choice uses the existing 1–4 survey semantics; `""` keeps evacuation ability unknown. Missing fields stay unknown/unchanged. The call stays active for the handoff. Updates arrive after the agent invokes the tool, not continuously word by word, and no fixed network latency is promised.

For matched calls, `transcript_line` is written by final ingestion with speakers `agent` and `resident`. All provider conversations, including unknown callers, also retain their ordered transcript in `call_record`. Its durable receipt prevents duplicates on retries. The final transcript and post-call analysis therefore arrive after call end. Existing request/household fields are the mid-call structured summary. Post-call Claude analysis is stored separately in `call_analysis` and displayed in Calls and the linked case file; it never rewrites confirmed rescue needs automatically.

## Human handoff

Transfer is **agent-driven** through ElevenLabs `transfer_to_number`. There is no operator reducer that directly transfers an ongoing SIP call in this version. The dispatcher approves rescue assignments separately. The prepared agent saves assessment answers, obtains the resident's agreement, invokes `request_handoff`, then invokes the configured transfer tool to the single allowlisted human ending 3841.

Public table: `call_handoff` (generated accessor `callHandoff`), primary key `callId`. Fields:

| Field | Meaning |
| --- | --- |
| `status` | `requested`, `ringing`, `connected`, or `failed` |
| `targetLabel` | Display label such as `Demo dispatcher ending 3841`; no full phone |
| `failureReason` | Failure text only on `failed` |
| `detail` | Provider/confirmation detail; display this for a pending handoff |
| `requestedAt`, `updatedAt` | Server observation timestamps |

`reportCallHandoff({ callId, status, targetLabel, failureReason?, detail? })` is service-only. `POST /elevenlabs/handoff` records `requested` before the transfer attempt. A final signed ElevenLabs tool error records `failed`. A SIP REFER success records detail that REFER was accepted and **leaves status requested**: this result does not establish that the friend answered. `ringing`/`connected` are supported by the reducer for actual carrier evidence; this integration does not fabricate either state or currently receive those carrier events. Terminal states cannot be regressed by a late retry. SIP REFER support on the Photon trunk remains an end-to-end test prerequisite; SIP transfers do not supply ElevenLabs' native Twilio warm-transfer whisper.

## Resident notice

`notifyResident({ requestId })` is operator-only. It requires an open request in `driver_accepted` or `en_route` with a live accepted assignment. It uses the server's factual status line. Acceptance already queues a message; this reducer reuses that delivery row and remembers it in private `resident_notice`, so repeated clicks do not send duplicates. The dispatcher owns retries: call `notifyResident` again only when delivery is `failed`; it changes the same message back to `queued`, clears its error and preserves the message ID/provider idempotency key. It leaves queued, sending, waiting and sent deliveries alone. The portal should show a retry button for a failed notice; the messaging service consumes the requeued row through its queued-message subscription. Read `message` by `householdId`/`requestStatus`, including `state`, `error`, and `providerId`, for queued/sending/waiting/sent/failed delivery. It does not itself invoke Photon. Messaging remains stopped, and the Houston public fixture's fictional phone alias will not receive a real text.

## Road route

`requestDispatchRoute({ assignmentId })` is operator-only, accepts a live proposed/offered/accepted assignment for an open request, and schedules an internal routing procedure. Public table `dispatch_route` (accessor `dispatchRoute`) is keyed by `assignmentId`:

| Field | Meaning |
| --- | --- |
| `requestId`, `vehicleId` | Case and assigned resource |
| `originLat`, `originLng` | Responder snapshot at request time |
| `destinationLat`, `destinationLng` | Resident snapshot |
| `points` | Array of `{ lat, lng }` road geometry points |
| `distanceMeters`, `durationSeconds` | Optional until ready |
| `source` | `osrm` |
| `state` | `pending`, `ready`, `failed` |
| `failureReason` | Provider failure, stale assignment/location, closure, or closed case |
| `revision`, `updatedAt` | Stale-response protection and observation time |

The dummy dispatcher is represented by the `vehicle` row named `Houston demo rescue unit`; use **`assignment.vehicleId → vehicle.id`** for its current `lat`/`lng`. No separate dispatcher-location table is added. The route snapshot stays unchanged if the vehicle moves; request a fresh route then. A pending route times out to `failed` after 30 seconds, enabling the portal retry button. `requestDispatchRoute` also accepts a pending row aged at least 30 seconds, covering abandoned work from before timeout scheduling existed. Each retry advances `revision`; late provider results and old timeout jobs cannot overwrite it.

Road geometry comes from OSRM `/route/v1/driving` with GeoJSON coordinates converted from `[lng, lat]`. `ROUTER_URL` optionally selects a self-hosted OSRM base URL; otherwise the public OSRM demo server is used. OSRM optimizes drive time against its road graph, without live traffic or disaster-specific road accessibility. The module rejects paths intersecting currently recorded closure points within 150 meters, but does not find closure-aware alternatives. It publishes failure rather than an invented straight line. No Claude/Gemini-generated road geometry is used. Reference: https://project-osrm.org/docs/v5.24.0/api/#route-service

Native OSRM fetch now sends explicit `Accept` and `User-Agent` headers and has been verified to return a ready road route on Maincloud while the bridge was paused. Earlier probes encountered TLS/runtime failures and non-success HTTP replies; their original status was discarded, so the exact earlier cause is not established. Native failures now log the actual HTTP status or runtime error without exposing provider details in public rows.

As a fallback, `npm run routes` starts a **route-only** Node bridge on `hackutd-richardson`, using an existing granted `SPACETIME_DEMO_SERVICE_TOKEN`. It subscribes to pending/provider-failed revisions, fetches real OSRM geometry over HTTPS, and calls service-only `recordDispatchRoute({ assignmentId, revision, points, distanceMeters?, durationSeconds?, failureReason? })`. The module rechecks revision, assignment, resident/responder locations and closures. This worker starts neither voice nor messaging and cannot revive a closed case. `npm run routes -- --once` processes the current backlog and exits. Local rehearsals can set `SPACETIME_ROUTE_URI` and `SPACETIME_ROUTE_DATABASE`; the operational database is forbidden. Portal callers still use only `requestDispatchRoute` and the same public row.

## Preparation and remaining live-test gates

From `services/`, `npm run demo:prepare` writes a private, gitignored SDK agent configuration and one-call contact plan under `services/.spacetime/`, with file mode 0600. It never applies provider changes or calls anyone. `npm run demo:prepare -- --seed --hazard hurricane` additionally seeds the synthetic Houston fixture on `hackutd-richardson`; use `flood` or `fire` for the other supported demonstrations. The seed is idempotent: it creates one queued survey, and repeating it never requeues a ringing/live/ended survey or erases its answers. It creates no survey for either human dispatcher's real number.

Before a real call: Anish must authorize applying the prepared configuration and restarting the voice process with its granted **demo service** token/target. `/capabilities` must return `liveAssessment: true`, the remote demo `uri`, and `database: "hackutd-richardson"`. `npm run demo:call` previews the one-call plan. Only `npm run demo:call -- --call` places the real interaction: it first verifies the service target, published agent assessment tools and single transfer destination, finds the queued synthetic profile, and atomically claims that call. It supplies the private resident contact mapping to the dialer, never queues a survey to a dispatcher number, and never automatically retries. The selected human must be ready to answer. Preparation/seeding do not dial. No real interaction has been exercised by unit tests or database rehearsals.

The embedded portal map draws the Houston incident polygon from `zone.geometryJson`, which the fixture sets to GeoJSON `Polygon` geometry using the same coordinates as `zone.rings`. Repeating the seed also backfills missing geometry on an existing fixture without resetting its calls or answers. The embedded map supports `zone.kind = "demo"`; `isLiveWarning` no longer blocks this demo polygon. Map integration belongs to Natroness. The NWS poller currently ingests tornado warnings. Backend code does not edit `map/` or the portal's components.

## Three-hazard Houston fixture

Operator-only `prepareHoustonDemo({})` requires an isolated, synthetic database without an operational heartbeat. It retires Richardson zones, takes their homes out of zone, closes their requests, releases assignments and cancels pending delivery work, while preserving history. It creates three Houston catalogue households/polygons alongside the reserved live-call alias. Seeding, assessment and closure immediately write `coverage`.

Public `catastrophe_case` (SDK `catastropheCase`) has primary key `householdId`, with `zoneId`, `hazard`, `runId`, optional `callId`, optional `duringSnapshotJson`, `simulated`, `updatedAt`. Join `household.id → catastrophe_case.householdId → zone.id`. **Use `catastrophe_case.hazard` per home:** `hurricane`, `flood`, or `wildfire` (display fire). `zone.event` has the same value. The singleton `control.hazard` cannot distinguish simultaneous incidents. All three catalogue zones are active; a simulation refreshes its chosen zone's timestamp to make it the newest incident. Every polygon has `zone.geometryJson`.

The in-zone catalogue deliberately includes hurricane `oxygen = true`, flood `mobility = "wheelchair"`, and fire `mobility = "bedbound"` with `assistance = "two_person_lift"`. Simulated answers preserve those fields in `request` and transcript text. Re-preparing upgrades only fixed synthetic catalogue records, records corrections, and leaves the reserved live household and previous run snapshots intact. `Houston demo medical unit` is a separate simulated ambulance with one stretcher space, a lift and two crew, so the fire rehearsal has a capable resource. The live-call household is never used for these badge demonstrations.

## Simulated CLI and closest dispatcher

From `services/`:

```bash
npm run catastrophe -- --hazard hurricane
npm run catastrophe -- --hazard flood --stage queued
npm run catastrophe -- --hazard fire --stage routed
npm run demo:rehearse -- --hazard flood
```

The default stage is `assessed`; alternatives are `queued`, `routed` and `closed`. `--run-id` supplies an idempotency key; the default generates a fresh timestamp-based ID. Operator-only, demo-guarded `simulateCatastrophe({ hazard, runId })` creates the chosen Houston polygon, spatially scans residents and queues their surveys. `simulateAssessment({ householdId })` deterministically writes structured answers, a request and exact `agent`/`resident` transcript turns once. The reserved `demo-houston-anish` alias is always excluded. Simulation call targets must have fictional 555 aliases. A repeated run ID never resets a completed case; use a new run ID for a fresh rehearsal. No voice/message runner or telephony provider is imported by these scripts.

The CLI uses an existing `SPACETIME_DEMO_OPERATOR_TOKEN`, or the persisted operator token from ignored `.spacetime/demo-auth.json`. It does not create identities or grant roles. Local tests can set `SPACETIME_SIMULATION_URI` and `SPACETIME_SIMULATION_DATABASE`; remote use is restricted to `hackutd-richardson`.

Operator-only `matchClosestDispatcher({ requestId })` proposes the geographically nearest free, capable vehicle whose initial ETA fits the pickup deadline. It uses shared capacity/mobility/crew rules, writes ordinary `plan`/`assignment` rows and requests `dispatch_route`. Normal portal use still requires operator approval and driver acceptance. This is a geographic match, not fleet-wide road-time optimization; OSRM supplies the selected unit's actual road geometry and duration. A recorded road closure can still make that route fail. The dummy unit is `vehicle.name = "Houston demo rescue unit"`; locate it through `assignment.vehicleId`.

The CLI's `routed`/`closed` stages explicitly simulate approval and acceptance. Demo-guarded, operator-only `simulateResidentDelivery({ requestId })` marks that scenario's notices sent with `message.providerId = "simulated:<id>"` and pending callbacks played, without any external send. It rejects the reserved live-call case.

## After-event evidence and rehearsal

Public `follow_up` (SDK `followUp`) has primary key `householdId`, with `requestId`, `state`, `simulated`, `questions` (`{ key, prompt, answer }[]`), `duringSnapshotJson`, `changesJson`, optional `insuranceSelf`, `insuranceVehicle`, `insuranceProperty`, and `updatedAt`.

Operator-only, demo-guarded `simulateFollowUp({ householdId })` requires a closed simulated case with a during-event snapshot. It records nine detailed questions covering safety/location, evacuation, household members, medical/equipment changes, housing/food, preferred contact and the three insurance categories. `changesJson` is an array of `{ field, before, after }`, with missing prior facts represented by `null`. Insurance may remain unknown. Follow-up never rewrites the original assessment or rescue needs/urgency. Real follow-up scheduling and sends remain disabled.

`npm run demo:rehearse` runs the same CLI flow through all seven stages, printing row IDs, state, coverage and road metrics. It requires a real ready OSRM route, closes the case, verifies vehicle release, then writes follow-up evidence. Run the route-only bridge with its existing service token first. The rehearsal never reaches ElevenLabs or Photon. Closure invalidates the route; afterward use `catastrophe -- --hazard hurricane --stage routed` to leave an inspectable line on the map.

## Live steps for Anish after approval

These operations are prepared, not performed by the simulation workstream:

1. From `services/`, run `npm run demo:prepare -- --seed --hazard hurricane` and note its private directory. The human ending 3841 must be ready; the resident ending 5303 is the only survey destination.
2. Preview `npm run demo:configure -- --config .spacetime/<printed-directory-name>/agent-config.json`. After approving the shared-agent change, add `--apply`. This privately backs up the old agent before updating it, and does not change the imported phone number or dial.
3. After approving a voice restart, stop the stale voice launcher/child and start `npm run voice` from `services/` with `SPACETIME_URI=wss://maincloud.spacetimedb.com`, `SPACETIME_DATABASE=hackutd-richardson`, and `SPACETIME_TOKEN` set privately to the existing granted service token. Do not start messaging or expose service tokens in `VITE_*` variables.
4. Check `GET <VOICE_PUBLIC_URL>/capabilities` for `liveAssessment: true`, the demo URI and `database: "hackutd-richardson"`. The provider webhook must reach that same public service URL. Keep the three-number allowlist and SIP credentials private.
5. Set `SPACETIME_DEMO_SERVICE_TOKEN` privately to the same service token. `npm run demo:call` previews. After approving the real interaction, `npm run demo:call -- --call` validates the published agent/tools/target, atomically claims the reserved survey and places one call. It refuses a consumed survey and never retries automatically. Resident consent precedes agent-driven handoff. Verify Photon supports SIP REFER; REFER acceptance alone does not prove a human answered.

Anish separately owns the portal's identity grant. These commands never grant it. No real call/text, shared-agent update or voice/message restart was performed during the simulated work.
