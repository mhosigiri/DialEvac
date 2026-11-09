# Local Twilio outreach

All code is on the local `twilio` branch. Nothing is pushed automatically.

`TWILIO_NUMBER` is the originating number, not a destination. The three destinations come only from `CONTACT_ALLOWLIST`. The browser sends an incident category and an idempotency key; it cannot supply phone numbers or receive credentials.

## Run

1. Keep a public HTTPS tunnel to port 8080 running and set `VOICE_PUBLIC_URL` to it.
2. In `services/`, run `npm run twilio:setup -- --prepare` to generate private launch and guard credentials.
3. Start/restart `npm run voice` so the public blocking guard is reachable.
4. Run `npm run twilio:setup`. This creates a separate guarded agent and signed transcript webhook, imports the Twilio number, and saves their IDs privately in `.env`. It does not place a call. Restart `npm run voice` afterward.
5. Start the portal with `npm run dev` in `dispatchers-portal/` and open `?view=outreach` on local port 3001 or 3002.
6. **Launch outreach places three real outbound calls.** The call panel shows provider submissions, speech, failures and uncertain outcomes. Pause/resume controls affect the visualization; calls continue.

Native Twilio integration retains the ElevenLabs voice agent, call-bound assessment tokens, signed guard context, exact approved speech, and the configured human transfer destination. Twilio conference transfer replaces SIP REFER. A transfer request is not treated as a connected dispatcher. No rescue assignment or arrival time is invented. Assessment writes must commit before saved-record speech is permitted.

Each batch reserves all three attempts in SQLite before sending any provider request. Calls submit concurrently. Duplicate requests reuse the existing receipt. Timeouts remain uncertain and block a new batch until their outcome is reconciled. No automatic redial occurs. Calls and actual speech/assessments live in the private `services/.spacetime/call-inbox/twilio-outreach.sqlite` database. Other provider calls retain the existing transcript ingestion path. Historical GSAP timelines remain separate from real Twilio call state.

## Busy-room speech

`npm run voice:noise` enables provider background-speech filtering, normal turn-taking (background filtering handles room noise without adding patient-mode pauses), disables speculative turns, and ignores non-answer fillers (`um`, `uh`, `hmm`, `mm-hmm`) as interruptions. It preserves genuine yes/no answers and interruptions. There is no public numeric audio-amplitude threshold for these phone agents, so the code uses the supported controls rather than adding an ignored field. The prior provider configuration is saved privately before applying changes.

## Conversation

The model only reports what the resident has said (`src/voice-intake.ts`, read afresh from the whole transcript each turn). Plain code then picks the next question, save, hand-off or hang-up, and the honesty guard still gates all speech. To change how the call flows, change `decideTurn`, not the agent's prompt: the guard does not read the prompt on the ElevenLabs agent.

`npm run eval:dialogue` rehearses whole conversations with free-form answers through the real guard endpoint and model. Add `-- --transcripts` to read them. It places no calls, and calls the model about ten times per conversation.

## Verification

Run `npm test` and `npm run typecheck` in `services/`, and `npm test` and `npm run build` in `dispatchers-portal/`. Tests use injected dialers and temporary databases; they do not place real calls. Browser verification must intercept `/api/outreach/launch` if testing the button without calling the three contacts.

The public tunnel and local voice process must remain running during the call. If the tunnel changes, update `VOICE_PUBLIC_URL`, rerun `twilio:setup`, and restart the receiver. Provider and account restrictions can still reject a dial; configuration checks do not prove a handset rang.
