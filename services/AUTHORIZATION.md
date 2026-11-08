# Dispatcher and service identities

The candidate module authorizes writes using `ctx.sender`, which Spacetime derives from the connection's signed JWT. A client cannot grant itself a role by passing an identity or role in reducer arguments. No existing reducer signature or table visibility changes.

Two optional **module** environment values grant access, as comma-separated 64-character identity hex strings (an optional `0x` prefix is accepted):

- `OPERATOR_IDENTITIES`: dispatcher actions, importing riders, zone/incident controls, road reports, and feed startup.
- `SERVICE_IDENTITIES`: voice/message delivery, webhooks, transcripts, and callback results.

`updateRecord` permits either role. All other operator/service permissions are separate. An absent, empty, or invalid grant list grants nobody that role. Scheduled functions accept only the database's own identity; its internal helpers continue to work without client credentials. Platform deployment permission does not itself grant application reducer permission.

## Portal connection contract

Keep each user's token stable between connections, scoped by server and database. Existing reducer arguments stay exactly the same. The integration at the connection builder is:

```ts
const key = `spacetime-operator:${uri}:${database}`;
const builder = DbConnection.builder()
  .withUri(uri)
  .withDatabaseName(database)
  .withToken(localStorage.getItem(key) ?? undefined)
  .onConnect((_connection, identity, token) => {
    localStorage.setItem(key, token);
    // Display identity.toHexString() so the publisher can grant this user.
    // Never display or log token.
  });
```

The initial connection can read public tables but cannot dispatch until its **identity** is granted. The browser sends its JWT over the SDK connection; it sends no extra authorization fields to a reducer. A publisher adds that exact `identity.toHexString()` value to `OPERATOR_IDENTITIES`. Using an OIDC login token with `.withToken(...)` is also supported. A local browser token must be protected from cross-site scripting like any other session credential. Never put a service JWT or a shared operator JWT in a `VITE_*` variable: those become public bundle contents.

## Service connection contract

Create a separate Spacetime identity/token for the service, persist the token in a private secret store or `.env` as `SPACETIME_TOKEN`, and grant its actual connection identity through `SERVICE_IDENTITIES`. `services/src/db.ts` already supplies that token through `.withToken(...)`. Voice and messaging may share a dedicated service identity, or each can have a listed identity. Do not use an operator token for services.

A valid token's identity is the `identity` argument returned by SDK `onConnect`; do not use the database identity, provider API key, or an unverified decoded JWT claim as a substitute. A publisher can grant or revoke roles using an environment-only publish; unspecified environment values are retained. For example, for the **isolated demo**:

```sh
OPERATOR_IDENTITIES='<portal identity hex>' SERVICE_IDENTITIES='<service identity hex>' \
  spacetime publish hackutd-richardson --server maincloud --env-only --no-config --yes=remote,migrate,skip-login
```

Keep the other shell module environment variables unset for this command. Do not run it against `hackutd-535md` until Anish approves the prepared rollout. Rotate a credential by granting the replacement identity first, switching the client token, then removing the old identity. Removing the identity makes subsequent reducer calls fail; it does not erase existing data.

## Demo and verification

The five public fixture reducers remain available only under the existing `DEMO_MODE=isolated`, all-simulated-data, no-active-incident guards. They do not grant ordinary operator/service access. Demos fail closed on the operational database. Preserve this boundary rather than enabling demo mode there.

For the synthetic connector check, provide the granted demo service token privately as `SPACETIME_DEMO_SERVICE_TOKEN` and run `npm run check:connections -- --write-demo`. It only writes `hackutd-richardson`; the operational connection stays read-only, and no voice or message runners start. The check tests durable transcript deduplication by sending the same final conversation twice.

For the live role/closure/webhook rehearsal, also provide `SPACETIME_DEMO_OPERATOR_TOKEN` and run `npm run check:safety`. It uses the actual voice handler against synthetic records, including inbound calls missing from the service's active-call cache. It rejects the operational target, verifies forbidden writes fail, and resets its demo fixture on completion. `SPACETIME_SAFETY_URI` / `SPACETIME_SAFETY_DATABASE` optionally target a separate local rehearsal database; on Maincloud it accepts only `hackutd-richardson`.

Real services must stay stopped during a migration/rehearsal. Publishing the module never authorizes a real phone call or message. Real contact requires Anish's explicit go-ahead and is limited to `CONTACT_ALLOWLIST`.

## Public reads are a separate rollout

The existing 17 public tables still expose their rows to ungranted readers, including phone numbers, household needs, messages and transcripts. Reducer authorization prevents unauthorized writes; it does not close this read exposure.

Closing it requires a separately approved client migration: move sensitive base tables behind private access and expose role-authorized views, or introduce tested client visibility filters backed by a private membership table. Give the public map sanitized warning/fleet views with no household, contact, health or transcript details. Migrate portal and service subscriptions to their authenticated views first, rehearse revocation and reconnect behavior, then remove public base-table access in a coordinated deployment. Existing anonymous `SELECT *` clients will otherwise stop receiving data. No table visibility or visibility filter is changed in this round.

Final conversation ingestion adds only the private `transcript_receipt` table and `recordCallTranscript` reducer. The receipt and every turn commit together. Inbound ingestion first calls the unchanged `inboundCallEnded`, then supplies `{ providerId, phone, turns }`; the module finds that ended call even though it is absent from the service's active-call subscription. Outbound calls supply `callId`; callback conversations supply `callbackId`. Stored speakers are `agent` and `resident`. Replayed final conversations add no lines, while genuinely repeated words inside one conversation remain separate turns.
