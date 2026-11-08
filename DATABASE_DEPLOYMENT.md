# Updating the shared Spacetime database

The shared database is `hackutd-535md` on Maincloud. Treat its deployed schema and existing data as the baseline. Do not reset it to match an older checkout.

## Compatibility requirements

- Preserve all 23 deployed tables, their ordered columns/types, defaults, indexes, unique constraints, sequences, schedules, and public/private access.
- In particular, retain `feed_health`, the eight appended optional `zone` fields, and the `zone.source` index. Older versions of `main` omit these and cannot be republished over the deployed database.
- Add `inbound_call_ended` and `message_waiting` for the local services, while keeping existing reducer names and argument signatures.
- Keep `DEMO_MODE` unset on the operational Maincloud database `hackutd-535md`. The optional setting is only enabled as `isolated` for the separate Maincloud demo database `hackutd-richardson`. Public demo reducers reject missing opt-in, real households/vehicles, and active incidents.
- Preserve stored module environment values. Do not load service `.env` into the publish process or use `--replace-env`.
- The safety update adds private `transcript_receipt`, `resident_notice`, `route_job`, `route_timeout` and public `call_handoff`, `dispatch_route`, `catastrophe_case`, `follow_up` tables (31 total). Existing 23 operational tables and existing function signatures stay intact. Optional `OPERATOR_IDENTITIES` and `SERVICE_IDENTITIES` module settings deny client writes until explicitly granted; optional `ROUTER_URL` selects the OSRM endpoint. See [services/AUTHORIZATION.md](services/AUTHORIZATION.md) and [services/PORTAL_CONTRACT.md](services/PORTAL_CONTRACT.md).

Spacetime rejects removing existing columns or nonempty tables during automatic migration. Appended columns need defaults. See the [current migration rules](https://spacetimedb.com/docs/databases/automatic-migrations/).

## Verification before publishing

1. Fetch current Git changes and inspect the live schema again; another developer may have deployed since the last review:

   ```bash
   spacetime describe hackutd-535md --server maincloud --json --no-config
   ```

2. Compare every deployed table and existing function signature with the candidate module. Rehearse the update against a populated, separate local database with the same baseline schema. Verify existing rows survive the update with `--delete-data=never`.
3. Run module and service tests/typechecks. Regenerate bindings and build every client:

   ```bash
   (cd services && npm run generate && npm run typecheck && npm test)
   (cd spacetimedb && npm run typecheck && npm test)
   (cd map && npm run generate && npm run build && npm test && npx tsc --noEmit)
   (cd dispatchers-portal && npm run generate && npm run build)
   (cd dispatch && uv sync --frozen --python 3.12 && uv run --frozen python -m pytest tests)
   ```

   `.github/workflows/ci.yml` runs the four test suites (module, services/portal case rules, map, Python solver), every listed typecheck/build and all three client binding generators. It pins the Spacetime CLI to 2.14.1 and performs no database publication, provider calls or live connector write checks.

## Publishing

A database owner or collaborator with deployment permission must run the publish. Use a clean shell without exported `DEMO_MODE`, `FEED_AREA`, `SOLVER_URL`, or `SOLVER_TOKEN`, so existing server settings are preserved:

```bash
spacetime publish hackutd-535md --module-path spacetimedb --server maincloud --delete-data=never --no-config --yes=remote,migrate,skip-login
```

If the server reports a migration conflict or insufficient permission, stop and reconcile the cause. Do not add `--delete-data=always` or `--delete-data=on-conflict`.

After publishing, verify the live schema, the service reducers, and the client subscriptions. A successful WebSocket handshake alone does not prove the reducers used by a service are deployed. The public map's live connection is read-only; operators start the feed separately with `startFeeds`. Live NWS warning ingestion remains display-only. An outreach workflow explicitly sets its area with `setZone` and starts an incident with `issueWarning`.

## Remote demo

The map's demo database is `hackutd-richardson` on Maincloud, published with `DEMO_MODE=isolated`. It is separate from the operational Maincloud database `hackutd-535md`, where demos remain disabled. Both default targets are declared in `shared/spacetime.ts`. The root README documents remote demo deployment and the read-only / synthetic write connector checks. Never use the operational database as the demo target.

## Prepared safety rollout (requires Anish's approval for operations)

Operational rollout uses committed artifacts. The requested demo-only retry/geometry update was published from the reviewed working tree without creating a commit, per the current user instruction. The closure fix was first deployed to `hackutd-richardson` from `1ed231b`, after a populated local migration retained the fixture rows. It completes accepted assignments and ends open offers when a request closes, clears stale ETA, cancels pending callbacks and supersedes queued ride-status messages. Repeating `closeRequest` on an already closed request also repairs legacy accepted/open assignments without reopening it. Review those legacy rows before choosing which closed requests to repair in the operational database; do not reset or bulk rewrite them.

Before the authorization rollout, obtain each portal user's stable connection identity and a separate persisted service identity. Configure both grant lists at publish time, leave operational `DEMO_MODE` unset, and retain all existing solver/feed secrets. Ungranted clients can still read public tables but their writes will fail. Arrange a coordinated service restart only after Anish approves it; do not start voice or messaging during verification. The current deployment gate prohibits publishing to or mutating `hackutd-535md`.

Real transcripts use `recordCallTranscript`, which atomically records a final conversation and its private deduplication receipt. Deploy that reducer before switching running services to the new handler. No process automatically restarts when this code changes. Full setup, client token requirements and the separate public-read migration are documented in [services/AUTHORIZATION.md](services/AUTHORIZATION.md).

The Houston integration adds service-only `recordCallAssessment`, `reportCallHandoff` and `recordDispatchRoute`, operator-only `notifyResident` and `requestDispatchRoute`, public-guarded `seedHoustonVoiceDemo`, and internal scheduled `calculateDispatchRoute`. Native routing sends explicit provider headers and logs real HTTP failures; the optional route-only service bridge retains the same module validation and portal contract. Only the isolated demo receives these changes in this round. Publishing preserves current identity grant lists; the portal grant remains Anish's task. Preparation and seeding never dial, and the call command previews unless its explicit `--call` flag is provided after live-test approval. Real contact details remain in private `.env`/generated artifacts; the public fixture uses a fictional phone alias.

The November 8 Houston demo update uses 31 tables, retains every pre-existing table/function signature, and preserves stored grants/settings with `--delete-data=never`. The reviewed uncommitted module artifact has SHA256 `b527d9071d41b0f72c24c9ffd7c20bba7a9dddbb914ba21aacbbadb5c73a0fab`. Publication preserves data; the explicitly requested fixture reset separately retires Richardson operations and writes coverage. Three remote simulated rehearsals (hurricane, flood, wildfire) reached a closed case with real OSRM geometry, released the vehicle and recorded compared after-event follow-ups. Native Maincloud routing also reached ready with the route bridge paused. Verification passed 182 module, 48 service, 17 solver, 3 map and 2 portal tests, all typechecks, binding generation and builds. Map generation/build ran in a separate temporary copy to respect ownership. All further work remains uncommitted; no real calls/texts, provider changes, voice/message restarts, grants, pushes or operational database writes were performed. Full contracts, simulation commands and Anish's prepared live steps are in `services/PORTAL_CONTRACT.md`.

The medical-needs fixture update preserves reserved household 42 and survey 19 exactly. In-zone open requests now include household 50/request 22 (oxygen), household 51/request 23 (wheelchair), and household 52/request 24 (bedbound/stretcher). Catalogue households 43–45 carry the same respective needs. Coverage reports 11 homes and zero overlooked; assignment 20/request 21 remains ready at revision 4 with 113 OSRM points. Schema and reducer entry sources are unchanged by this fixture update; publication preserved all 31 existing tables and stored settings.

## Durable call inbox and Claude analysis

The November 8 transcript-recovery update adds public `call_record` and `call_analysis` (33 tables total), plus service-only `recordProviderCall`, `claimCallAnalysis`, `finishCallAnalysis` and operator-only `retryCallAnalysis`. It preserves all 31 existing table definitions, existing reducer/procedure signatures, data, settings and grants. The reviewed uncommitted artifact SHA256 is `1910468e66340d866685051830d9df2f854b73f44b2a962cbfb05272126886e1`; publication used `--delete-data=never` on `hackutd-richardson` only. The latest user request authorizes repairing and restarting the receiving/analysis service; its replacement runs with outbound calling and messaging disabled. The existing workspace webhook now retries transient failures, and its destination/signing secret are unchanged. All five provider calls were recovered, with 39 real text turns and ready Claude analyses for the three completed calls. See [services/CALL_INGESTION.md](services/CALL_INGESTION.md) for tables, commands, recovery behavior, portal integration and verification. No commits or operational database writes were made.

## Explicit outbound CLI

The one-phone CLI update adds public `outbound_demo_attempt` and service-only `startDemoOutboundAttempt` (34 tables total). The reviewed module SHA256 is `40c2868b672cad0d23201289d455d2d15862be7ee918605d4bcf7d399548f102`. Publication used `--delete-data=never` on `hackutd-richardson`, preserving all 33 existing tables, 56 reducer signatures, stored settings/grants and contact/transcript/analysis history. The user explicitly authorized one real test call to the resident ending 5303; it failed immediately with SIP 603 and was recorded as call 33. No further call was placed. The CLI requires an explicit `--call --attempt <name>`, atomically consumes each name once, rejects overlap and disables provider retries. Details and the unresolved phone-provider rejection are in [services/OUTBOUND_DEMO.md](services/OUTBOUND_DEMO.md). No commits, texts or writes to `hackutd-535md` were made.
