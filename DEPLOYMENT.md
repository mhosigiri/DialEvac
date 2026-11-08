# Deploy the demo to the cloud

These steps move the `hackutd-richardson` demo off a laptop. The demo receives calls, archives and analyzes them, and serves the dispatcher, driver, and map apps. It places no outbound calls and sends no texts. The operational database `hackutd-535md` stays untouched.

## What runs where

SpacetimeDB stays on Maincloud. Run one always-on instance of each process below. All of them run background loops or hold open connections, so scale-to-zero stops them.

| Process | Image | Command | Network | Persistent path |
| :--- | :--- | :--- | :--- | :--- |
| `web` | `deploy/Dockerfile`, target `web` | Caddy | Public | `/data`, for TLS certificates |
| `inbox` | `deploy/Dockerfile`, target `services` | `npm run -s voice` | Private, reached through `web` | `/app/services/.spacetime` |
| `routes` | `deploy/Dockerfile`, target `services` | `npm run -s routes` | Outbound only, no port | None |
| `router` | `dispatch/Dockerfile.router` | `routing_server.py` | Private, no authentication | `/data/osmnx` |

`web` serves the portal at `/`, the driver app at `/driver/`, and the map at `/map/`. It forwards `/elevenlabs/*`, `/voice/*`, `/capabilities`, and `/ready` to `inbox`.

`deploy/compose.yml` runs this layout on one VM. On a container platform, create the same four processes and keep `inbox` and `router` on its private network.

## Settings

| Process | Variable | Value |
| :--- | :--- | :--- |
| `web` | `SITE_ADDRESS` | Your domain on a VM. `:<port>` behind a platform's TLS. |
| `web` | `INBOX_UPSTREAM` | Private `host:port` of `inbox`. |
| `inbox`, `routes` | `SPACETIME_DEMO_SERVICE_TOKEN` | The `service.token` value in `.spacetime/demo-auth.json`. Store it as a secret. It has no expiry. |
| `inbox` | `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET` | Copy from your local `.env`. |
| `inbox` | `ANTHROPIC_API_KEY` | `/ready` fails without it. |
| `inbox` | `CONTACT_ALLOWLIST` | Copy from your local `.env`. The handoff label and demo resident match use it. |
| `routes` | `OSMNX_ROUTER_URL` | Private URL of `router`. Without it, every route fails. |
| `routes` | `GEMINI_API_KEY` | Without it, drivers get directions but no Gemini brief. |

These are build arguments of the `web` target, with demo values as defaults: `VITE_SPACETIME_URI`, `VITE_SPACETIME_DATABASE`, and `VITE_MAP_URL`. To change one, rebuild the image.

`inbox` and `router` also honor a platform's `PORT`.

## Size the machines

`router` used 385 MB with one 8,400-node road graph loaded, and it keeps up to four graphs in memory. Start `router` at 2 GB and watch its memory during a rehearsal. The other processes run on 512 MB as a starting guess.

## Seed the road cache before the first route

`router` downloads a road graph from the public Overpass service the first time it sees an area. Overpass fails often, and an empty cache then turns every first route into `Routing provider unavailable`. Copy your verified graphs to the new `router` volume. The cache at `dispatch/.cache/osmnx` is gitignored, so copy it to the VM first.

```bash
docker compose --file deploy/compose.yml cp dispatch/.cache/osmnx/. router:/data/osmnx/
```

Routes in areas outside the seeded graphs still need Overpass. To use another Overpass server, set `OSMNX_OVERPASS_URL` on `router`.

## Deploy

Before you start, commit your changes and confirm that CI passes.

1. Publish the module from a clean shell. Do not load `.env`, because its `SOLVER_URL` points at loopback.

   ```bash
   spacetime publish hackutd-richardson --module-path spacetimedb --server maincloud --delete-data=never --no-config --yes=remote,migrate,skip-login
   ```

2. Decide who can operate the demo. See [Close public access](#close-public-access).
3. On the VM, clone the repository and create `.env` in the repository root with the settings above. Set `SITE_ADDRESS` in the shell, and point the domain's DNS at the VM.

   ```bash
   SITE_ADDRESS=demo.example.com docker compose --file deploy/compose.yml up --build --detach router web
   ```

   Then seed the road cache as described in [Seed the road cache before the first route](#seed-the-road-cache-before-the-first-route).

4. Stop the laptop's `call-inbox`, `route-bridge`, and `cloudflared` processes. If two copies of a worker run, both act on the same calls and routes.
5. Start the workers.

   ```bash
   SITE_ADDRESS=demo.example.com docker compose --file deploy/compose.yml up --build --detach inbox routes
   ```

6. Set `VOICE_PUBLIC_URL` to `https://demo.example.com` in your local `.env`.
7. Point the ElevenLabs agent at the new address. Run the script on your laptop, because it writes the new webhook id and signing secret to your local `.env`. It previews without `--apply`, and it changes no other agent setting.

   ```bash
   cd services && npm run voice:webhook -- --apply
   ```

   Do not use `npm run setup:elevenlabs` for this step. That script replaces the whole agent configuration and the SIP trunk settings.

8. Copy the new `ELEVENLABS_WEBHOOK_SECRET` to the VM's `.env`, and restart `inbox`. Calls that end before the restart fail signature checks, and `inbox` recovers them from provider history within 30 seconds of its restart.
9. Run the preflight from `services/`. It places no calls.

   ```bash
   npm run demo:preflight
   ```

10. Place one real inbound call. Confirm that its transcript and Claude analysis appear in the portal.

## Close public access

Two exposures exist on `hackutd-richardson` today:

- `DEMO_PUBLIC_DISPATCH=true` makes every browser an operator, and the apps have no login.
- Anyone can read the public tables without signing in, including the transcripts in `call_record`.

Publishing the site makes both reachable by anyone who finds the URL. To turn off public dispatch, run the following command, then grant each browser as described in [services/AUTHORIZATION.md](services/AUTHORIZATION.md). The driver app also needs an operator grant.

```bash
spacetime publish hackutd-richardson --server maincloud --env-only --unset-env DEMO_PUBLIC_DISPATCH --no-config --yes=remote,migrate,skip-login
```

## Restore the demo queue

The portal lists only homes inside the zone. **Save outreach area** on the Incident tab replaces the zone, so a small boundary hides every home outside it and closes their unassigned requests. Closed requests stay closed.

Run this from `services/` to put all Houston homes back in the zone and top the queue up to 13 waiting requests. It previews without `--apply`. It uses households that have no request yet, and it places no calls.

```bash
npm run demo:cases -- --apply
```

Requests get a deadline about 80 minutes out, so run it shortly before a rehearsal. In the driver app, pick a Houston unit. The app starts on Van 1, a Richardson unit, which receives no Houston offers.

## What the demo does not include

- `messaging` is not deployed. It defaults to `hackutd-535md`, and it needs a granted `SPACETIME_TOKEN`.
- The solver image is optional. `SOLVER_URL` is unset on the demo, so the module plans with its built-in heuristic.
- Outbound calls need a runner and the blocking speech guard. See [services/VOICE_RELIABILITY.md](services/VOICE_RELIABILITY.md).
