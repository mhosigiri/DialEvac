# Updating the shared Spacetime database

The shared database is `hackutd-535md` on Maincloud. Treat its deployed schema and existing data as the baseline. Do not reset it to match an older checkout.

## Compatibility requirements

- Preserve all 23 deployed tables, their ordered columns/types, defaults, indexes, unique constraints, sequences, schedules, and public/private access.
- In particular, retain `feed_health`, the eight appended optional `zone` fields, and the `zone.source` index. Older versions of `main` omit these and cannot be republished over the deployed database.
- Add `inbound_call_ended` and `message_waiting` for the local services, while keeping existing reducer names and argument signatures.
- Keep `DEMO_MODE` unset on the operational Maincloud database `hackutd-535md`. The optional setting is only enabled as `isolated` for the separate Maincloud demo database `hackutd-richardson`. Public demo reducers reject missing opt-in, real households/vehicles, and active incidents.
- Preserve stored module environment values. Do not load service `.env` into the publish process or use `--replace-env`.

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
   ```

## Publishing

A database owner or collaborator with deployment permission must run the publish. Use a clean shell without exported `DEMO_MODE`, `FEED_AREA`, `SOLVER_URL`, or `SOLVER_TOKEN`, so existing server settings are preserved:

```bash
spacetime publish hackutd-535md --module-path spacetimedb --server maincloud --delete-data=never --no-config --yes=remote,migrate,skip-login
```

If the server reports a migration conflict or insufficient permission, stop and reconcile the cause. Do not add `--delete-data=always` or `--delete-data=on-conflict`.

After publishing, verify the live schema, the service reducers, and the client subscriptions. A successful WebSocket handshake alone does not prove the reducers used by a service are deployed. The public map's live connection is read-only; operators start the feed separately with `startFeeds`. Live NWS warning ingestion remains display-only. An outreach workflow explicitly sets its area with `setZone` and starts an incident with `issueWarning`.

## Remote demo

The map's demo database is `hackutd-richardson` on Maincloud, published with `DEMO_MODE=isolated`. It is separate from the operational Maincloud database `hackutd-535md`, where demos remain disabled. Both default targets are declared in `shared/spacetime.ts`. The root README documents remote demo deployment and the read-only / synthetic write connector checks. Never use the operational database as the demo target.
