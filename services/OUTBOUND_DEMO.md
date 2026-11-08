# One-phone outbound demonstration

The CLI can originate one call to the configured resident ending **5303**, then let the existing receiver store its transcript and Claude analysis in the dispatcher's **Calls** view. It uses the existing Photon **Beta (2.0)** SIP trunk and ElevenLabs agent. It does not require a human transfer, change the agent, enable automatic calling, or start messaging.

From `services/`, run the read-only preflight:

```sh
npm run demo:outbound
```

To intentionally call the selected phone once:

```sh
npm run demo:outbound -- --call --attempt judges-01 --wait
```

`--call` is the explicit real-call trigger. `--attempt` is required when dialing. Its name is consumed atomically before the external request; running the same name again cannot call the phone twice. For a separate rehearsal, deliberately choose another name, such as `rehearsal-02`, after checking the previous call's outcome. Concurrent calls to the same resident are refused. No HTTP or provider auto-retries are enabled for the dial. A transport timeout leaves the call open because the external outcome is uncertain; inspect the provider/portal before doing anything further.

`--wait` only observes the call, transcript and analysis. It does not retry a rejected or unanswered call. Phone connections may be rejected even when the API accepts a request. Judge success by the phone ringing, two-way audio, an ended call, saved transcript, and a ready Claude analysis.

## Required configuration

Use the existing private root `.env`: the three-contact `CONTACT_ALLOWLIST`, `VOICE_FROM_NUMBER`, Photon outbound SIP server/username/password, ElevenLabs API key/agent/phone-number ID, webhook ID and public receiver URL. The command reads an existing granted `SPACETIME_DEMO_SERVICE_TOKEN`, or the persisted service token in `.spacetime/demo-auth.json`. It never grants an identity or accepts an arbitrary `--phone` destination.

The receive/archive/analyze service must be running (`npm run voice`), with the existing tunnel pointing to port 8080. The CLI checks the live receiver's demo target and transcript/Claude capabilities, outbound TLS configuration, imported number/agent, transcript webhook and synthetic resident before it consumes an attempt. It uses only `hackutd-richardson`; it does not change the operational target in the root `.env` or write to `hackutd-535md`.

Public `outbound_demo_attempt` maps `attempt_id` to `call_id` and `household_id`, with a creation timestamp. Service-only `startDemoOutboundAttempt` requires the opted-in isolated database, synthetic reserved resident, stand-in voice disabled, and no active call to that resident. It creates the ringing call and attempt receipt atomically. Post-call ingestion joins the actual provider conversation to that call; existing transcripts and analysis use the normal recovery pipeline. The reserved queued survey and all prior call history are preserved.

The older `npm run demo:call` remains the separate, stricter human-handoff demonstration. It expects the prepared assessment/transfer configuration. `demo:outbound` is the simpler single-phone survey demonstration and does not require a second person to answer a transfer.

## Current live result and main issue

The user explicitly authorized **one** test call. Attempt `authorized-test-20261108-01` created call **33** and provider conversation **`conv_2301m6xn9zref3rr2psarc99cb2z`** at **7:24:33 AM Central on November 8, 2026**. The phone/SIP path rejected it immediately with **603 Decline**, provider category **`line_busy`**, zero conversation seconds. No retry was performed. The failed call is retained in the portal; no transcript was invented.

The two earlier outgoing calls failed with the same code to the same destination. Read-only verification found Photon outbound enabled, SHA-256 authentication, the matching SIP username and TLS endpoint (`sip.photon.codes:5061`), matching originating number and the correct assigned ElevenLabs agent. Incoming calls already work. These checks do not prove that the stored outbound password or downstream phone/carrier route accepts calls. `603`/`line_busy` alone does not establish whether the recipient, carrier, or SIP provider rejected the call.

Next diagnostic step: inspect **Photon → Voice → Recent calls** and **ElevenLabs → Conversations** for this exact attempt. Photon/ElevenLabs support can correlate outbound call ID `otb_9401m6xn9zrdfq6b265n2fcz38td` and the conversation ID above to the SIP trace. The ElevenLabs SIP-message API returned HTTP 403 to the current credential; Photon developer logs contained no matching 603 entry. No credentials were rotated and no shared call settings were changed speculatively. Confirm phone blocking/silencing and provider-side rejection details before deliberately making a new attempt.

All 201 module tests, 56 service tests and 10 portal tests passed, along with typechecks, portal bindings/build and a populated local migration. Publication preserved all 33 existing table definitions and 56 reducer signatures, adding only the attempt table and reducer. No commits, texts, grants or operational database writes were made.

References: [Photon Beta ElevenLabs setup](https://photon.codes/docs/beta/cookbooks/voice/elevenlabs), [ElevenLabs SIP trunking](https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking).
