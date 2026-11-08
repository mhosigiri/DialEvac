# Houston single-call demo and portal integration

The target is **Maincloud `hackutd-richardson` only**. This round must not publish to or mutate `hackutd-535md`, change operator grants, start/restart voice or messaging, or send real calls/messages. Anish owns portal identity grants. The public fixture uses `shared/demo.ts`: a synthetic Houston address, coordinates near Buffalo Bayou, and fictional phone alias. The actual resident and selected human numbers come only from the three-number `.env` allowlist and private generated files.

## Mid-call assessment

`recordCallAssessment({ callId, providerId, choice, people?, oxygen? })` is service-only. A signed per-call agent tool at `POST /elevenlabs/assessment` invokes it during the live survey. The API response is successful only after the reducer commits. Portal subscriptions then receive:

- `household.canLeave`, `mobility`, `assistance`, `people`, `oxygen`, `reach` from confirmed answers.
- The corresponding `request` creation/update and its needs fields, plus `correction` entries for changed recorded values.
- `call.phase = "live"` and the real `call.providerId`.

Choice uses the existing 1–4 survey semantics; `""` keeps evacuation ability unknown. Missing fields stay unknown/unchanged. The call stays active for the handoff. Updates arrive after the agent invokes the tool, not continuously word by word, and no fixed network latency is promised.

`transcript_line` is still written only by the final post-call ingestion, with speakers `agent` and `resident`. Its durable receipt prevents duplicates on retries. The final transcript and post-call analysis therefore arrive after call end. Existing request/household fields are the mid-call structured summary; there is no separate LLM-generated case-summary column.

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

`notifyResident({ requestId })` is operator-only. It requires an open request in `driver_accepted` or `en_route` with a live accepted assignment. It uses the server's factual status line. Acceptance already queues a message; this reducer reuses that delivery row and remembers it in private `resident_notice`, so repeated clicks do not send duplicates. Read `message` by `householdId`/`requestStatus`, including `state`, `error`, and `providerId`, for queued/sending/waiting/sent/failed delivery. It does not itself invoke Photon. Messaging remains stopped, and the Houston public fixture's fictional phone alias will not receive a real text.

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

The dummy dispatcher is represented by the `vehicle` row named `Houston demo rescue unit`; use **`assignment.vehicleId → vehicle.id`** for its current `lat`/`lng`. No separate dispatcher-location table is added. The route snapshot stays unchanged if the vehicle moves; request a fresh route then.

Road geometry comes from OSRM `/route/v1/driving` with GeoJSON coordinates converted from `[lng, lat]`. `ROUTER_URL` optionally selects a self-hosted OSRM base URL; otherwise the public OSRM demo server is used. OSRM optimizes drive time against its road graph, without live traffic or disaster-specific road accessibility. The module rejects paths intersecting currently recorded closure points within 150 meters, but does not find closure-aware alternatives. It publishes failure rather than an invented straight line. No Claude/Gemini-generated road geometry is used. Reference: https://project-osrm.org/docs/v5.24.0/api/#route-service

## Preparation and remaining live-test gates

From `services/`, `npm run demo:prepare` writes a private, gitignored SDK agent configuration and one-call contact plan under `services/.spacetime/`, with file mode 0600. It never applies provider changes or calls anyone. `npm run demo:prepare -- --seed --hazard hurricane` additionally seeds the synthetic Houston fixture on `hackutd-richardson`; use `flood` or `fire` for the other supported demonstrations. The seed is idempotent: it creates one queued survey, and repeating it never requeues a ringing/live/ended survey or erases its answers. It creates no survey for either human dispatcher's real number.

Before a real call: Anish must authorize applying the prepared configuration and restarting the voice process with its granted **demo service** token/target. `/capabilities` must return `liveAssessment: true`, the remote demo `uri`, and `database: "hackutd-richardson"`. `npm run demo:call` previews the one-call plan. Only `npm run demo:call -- --call` places the real interaction: it first verifies the service target, published agent assessment tools and single transfer destination, finds the queued synthetic profile, and atomically claims that call. It supplies the private resident contact mapping to the dialer, never queues a survey to a dispatcher number, and never automatically retries. The selected human must be ready to answer. Preparation/seeding do not dial. No real interaction has been exercised by unit tests or database rehearsals.

Map integration belongs to Natroness. Its current `isLiveWarning` filter excludes `zone.kind = "demo"`, so it needs an owner-approved path for the Houston demo polygon and the `dispatch_route.points` overlay. The NWS poller currently ingests tornado warnings. Backend code does not edit `map/` or the portal's components.
