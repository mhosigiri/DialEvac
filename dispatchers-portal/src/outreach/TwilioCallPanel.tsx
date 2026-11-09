import React, { useState } from "react";
import { Phone, Radio } from "lucide-react";
import { Card, CardHeader } from "../design-system/Card";
import { Badge, type BadgeTone } from "../design-system/Badge";
import type { OutreachBatch, OutreachPhase } from "../../../shared/outreach";
const TONES: Record<OutreachPhase, BadgeTone> = { reserved: "warning", ringing: "warning", live: "success", completed: "neutral", failed: "danger", uncertain: "warning" };
const LABELS: Record<OutreachPhase, string> = { reserved: "Submitting", ringing: "Call submitted", live: "Conversation active", completed: "Completed", failed: "Failed", uncertain: "Verify outcome" };
export function TwilioCallPanel({ batch, connected }: { batch?: OutreachBatch; connected: boolean }) {
  const [selected, setSelected] = useState<string>();
  const current = batch?.contacts.find(contact => contact.callId === selected) ?? batch?.contacts[0];
  return <Card label="Twilio outbound calls" className="outreach-twilio">
    <CardHeader title="Twilio outbound calls" action={connected ? undefined : <Badge dot tone="warning">Service unavailable</Badge>} />
    <div className="outreach-real-contacts">{batch?.contacts.map(contact => <button key={contact.callId} onClick={() => setSelected(contact.callId)} aria-pressed={current?.callId === contact.callId}>
      <Phone size={15} /><span>{contact.label}</span><Badge tone={TONES[contact.phase]}>{LABELS[contact.phase]}</Badge>
    </button>)}</div>
    {current && <div className="outreach-real-transcript" role="log" aria-label="Twilio call transcript" aria-live="polite">
      {current.error && <p role="status" style={{ color: "var(--ds-warning)" }}>{current.error}</p>}
      {current.turns.length ? current.turns.map((turn, index) => <p key={index}><strong>{turn.speaker === "resident" ? "Resident · STT" : "AI agent · TTS"}</strong> {turn.text}</p>) : <p><Radio size={13} /> Waiting for the provider to connect and deliver speech…</p>}
    </div>}
  </Card>;
}
