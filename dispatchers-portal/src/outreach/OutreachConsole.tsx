import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowUpRight, Check, Download, Headphones, Pause, Play, Radio, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { CATASTROPHES, TRIAGE, type Catastrophe } from "../../../shared/catastrophe-triage";
import { callClassification, callPhase, createCalls, durationOf, readSession, saveSession, visibleTurns, type Session, type Speaker } from "./simulation";
import { MassCallNetwork, PHASE_COLOR, PHASE_LABEL } from "./MassCallNetwork";
import { Card } from "../design-system/Card";
import { PageHeader } from "../design-system/PageHeader";
import { Button } from "../design-system/Button";
import { Badge } from "../design-system/Badge";
import { Stat } from "../design-system/Stat";
import { Tabs } from "../design-system/Tabs";
import { useTwilioOutreach } from "./useTwilioOutreach";
import { TwilioCallPanel } from "./TwilioCallPanel";
import "./outreach.css";

const INITIAL: Session = { version: 1, category: "flood", size: 144, elapsed: 0, speed: 1, selected: 0 };
const SPEAKERS: Record<Speaker, string> = { resident: "Resident · STT", agent: "AI agent · TTS", dispatcher: "Dispatcher · STT" };
const clock = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function OutreachConsole() {
  const twilio = useTwilioOutreach();
  const [session, setSession] = useState<Session>(INITIAL);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [storage, setStorage] = useState<string>();
  const [tab, setTab] = useState<"conversation" | "events">("conversation");
  const [audio, setAudio] = useState(false);
  const latest = useRef(session);
  latest.current = session;
  const transcript = useRef<HTMLDivElement>(null);
  const spoken = useRef("");
  const calls = useMemo(() => createCalls(session.category, session.size), [session.category, session.size]);
  const duration = useMemo(() => durationOf(calls), [calls]);
  const current = calls[session.selected] ?? calls[0];
  const turns = visibleTurns(current, session.elapsed);
  const classification = callClassification(current, session.elapsed);
  const phase = callPhase(current, session.elapsed);
  const counts = { queued: 0, ringing: 0, live: 0, assessed: 0, handoff: 0, door_check: 0 };
  for (const call of calls) counts[callPhase(call, session.elapsed)]++;
  const completed = counts.assessed + counts.handoff + counts.door_check;
  const events = calls.flatMap(call => {
    const result = call.turns.filter(turn => turn.end <= session.elapsed).map(turn => ({ at: turn.end, call, label: SPEAKERS[turn.speaker], text: turn.text }));
    if (call.startsAt <= session.elapsed) result.push({ at: call.startsAt, call, label: "Outbound", text: "Call initiated" });
    if (callPhase(call, session.elapsed) === "door_check") result.push({ at: call.startsAt + 9000, call, label: "Door check", text: "No answer. Physical welfare check required; safety unconfirmed." });
    return result;
  }).sort((a, b) => b.at - a.at || a.call.id - b.call.id);

  useEffect(() => {
    let active = true;
    readSession().then(saved => { if (active) { if (saved) setSession(saved); setStorage(undefined); } }).catch(() => { if (active) setStorage("Session could not be saved. Keep this page open to preserve progress."); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const save = () => { void saveSession(latest.current).then(() => setStorage(undefined), () => setStorage("Session could not be saved. Keep this page open to preserve progress.")); };
    const interval = window.setInterval(save, 1000);
    window.addEventListener("pagehide", save);
    return () => { clearInterval(interval); window.removeEventListener("pagehide", save); void saveSession(latest.current).catch(() => undefined); };
  }, [ready]);
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setSession(value => ({ ...value, elapsed: Math.min(duration, value.elapsed + delta * value.speed) }));
    }, 80);
    return () => clearInterval(interval);
  }, [running, duration]);
  useEffect(() => { if (session.elapsed >= duration) setRunning(false); }, [session.elapsed, duration]);
  useEffect(() => {
    const node = transcript.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [session.elapsed, session.selected, tab]);
  useEffect(() => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); spoken.current = ""; return () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }; }, [running, audio, session.selected, session.category]);
  useEffect(() => {
    if (!audio || !running || !("speechSynthesis" in window)) return;
    const turn = current.turns.find(t => t.start <= session.elapsed && t.end > session.elapsed);
    if (!turn || turn.speaker !== "agent") return;
    const key = `${session.category}:${current.id}:${turn.start}`;
    if (spoken.current === key) return;
    spoken.current = key;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(turn.text);
    utterance.rate = session.speed;
    window.speechSynthesis.speak(utterance);
  }, [audio, running, session.elapsed, session.category, session.speed, current]);

  function reset(category: Catastrophe = session.category, size = session.size) {
    setRunning(false);
    twilio.resetAttempt();
    spoken.current = "";
    setSession(value => ({ ...value, category, size, elapsed: 0, selected: 0 }));
  }
  function exportLogs() {
    const blob = new Blob([JSON.stringify({ mode: "synthetic-local-rehearsal", category: session.category, elapsedMs: Math.round(session.elapsed), events: [...events].reverse().map(event => ({ atMs: event.at, household: event.call.id + 1, speaker: event.label, text: event.text })) }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `dialevac-${session.category}-outreach.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="outreach-console">
    <div className="outreach-main">
      <PageHeader title="Resident outreach" description="Reach affected households in parallel. Understand their needs. Coordinate the response."
        status={<Badge dot tone={running ? "success" : "neutral"}>{running ? "Outreach active" : session.elapsed >= duration ? "Complete" : session.elapsed ? "Paused" : "Ready"}</Badge>}
        actions={<>
          <Button disabled={twilio.launching} variant="secondary" aria-label="Reset outreach" title="Reset outreach" onClick={() => reset()} leadingIcon={<RotateCcw size={15} />} />
          <select className="outreach-speed" aria-label="Playback speed" value={session.speed} onChange={e => setSession(s => ({ ...s, speed: Number(e.target.value) }))}><option value="1">1× speed</option><option value="2">2× speed</option><option value="4">4× speed</option></select>
          <Button disabled={!ready || twilio.launching} loading={twilio.launching} onClick={async () => {
            if (running) { setRunning(false); return; }
            if (twilio.hasLaunched && session.elapsed < duration) { setRunning(true); return; }
            if (session.elapsed >= duration) reset();
            if (!twilio.hasLaunched) setSession(s => ({ ...s, elapsed: 0 }));
            setRunning(true);
            if (!await twilio.launch(session.category)) setRunning(false);
          }} leadingIcon={running ? <Pause size={16} /> : <Play size={16} />}>{running ? "Pause visualization" : !twilio.hasLaunched ? "Launch outreach" : session.elapsed >= duration ? "Launch again" : "Resume visualization"}</Button>
        </>} />
      {twilio.error && <p role="alert" className="outreach-call-error">{twilio.error}</p>}
      <TwilioCallPanel batch={twilio.batch} connected={twilio.connected} />
      <div className="outreach-scenario"><span className="outreach-eyebrow">HOUSTON, TX / INCIDENT</span>
        <Tabs variant="segmented" items={CATASTROPHES.map(category => ({ id: category, label: TRIAGE[category].label }))} activeId={session.category}
          onChange={id => { const category = CATASTROPHES.find(category => category === id); if (category) reset(category); }} />
        <label>Households <select aria-label="Household count" value={session.size} onChange={e => reset(session.category, Number(e.target.value))}><option value="72">72</option><option value="144">144</option><option value="288">288</option></select></label></div>
      <Card label="Outreach metrics" className="outreach-stats" style={{ padding: "18px 0" }}>
        {[{ label: "Households in zone", value: calls.length, detail: "Inside the affected area" }, { label: "Concurrent calls", value: counts.live + counts.ringing, detail: `${counts.ringing} ringing · ${counts.live} connected` }, { label: "Assessed", value: counts.assessed + counts.handoff, detail: "Responses captured" }, { label: "Dispatcher handoffs", value: counts.handoff, detail: "Priority human review" }, { label: "Door checks", value: counts.door_check, detail: "Unanswered ≠ safe" }].map(stat => <div className="outreach-stat" key={stat.label}><Stat label={stat.label} value={stat.value.toLocaleString()} sub={stat.detail} /></div>)}
      </Card>
      <div className="outreach-workspace">
        <div className="outreach-left"><Card label="Mass calling" className="outreach-panel outreach-network-panel" style={{ padding: 0 }}><div className="outreach-panel-heading"><div><Radio size={16} /><h2>Mass calling</h2><span className={`outreach-status ${running ? "is-running" : ""}`}>{running ? "OUTREACH ACTIVE" : session.elapsed >= duration ? "COMPLETE" : session.elapsed ? "PAUSED" : "READY TO LAUNCH"}</span></div><span className="outreach-mono">{clock(session.elapsed)} / {clock(duration)}</span></div>
          <MassCallNetwork calls={calls} elapsed={session.elapsed} selected={session.selected} onSelect={selected => setSession(s => ({ ...s, selected }))} />
          <div className="outreach-legend">{(["queued", "ringing", "live", "assessed", "handoff", "door_check"] as const).map(key => <span key={key}><i style={{ background: PHASE_COLOR[key] }} />{PHASE_LABEL[key]}</span>)}</div>
          <div className="outreach-timeline"><input aria-label="Outreach timeline" type="range" min="0" max={duration} step="80" value={session.elapsed} onChange={e => { setRunning(false); setSession(s => ({ ...s, elapsed: Number(e.target.value) })); }} /><div><span>{completed} of {calls.length} calls resolved</span><span>{events.length.toLocaleString()} recorded events</span></div></div>
        </Card>
        <Card label="Adaptive triage" className="outreach-panel outreach-triage" style={{ padding: 0 }}><div className="outreach-panel-heading"><div><Activity size={16} /><h2>Adaptive triage</h2></div><span className="outreach-eyebrow">OBSERVE → CLASSIFY → ASK</span></div>
          <div className="outreach-triage-content"><div><span className="outreach-eyebrow">01 / RESIDENT SIGNAL</span><blockquote>{classification.kind === "classified" ? `“${classification.evidence}”` : "Waiting for the resident to describe the danger…"}</blockquote><div className="outreach-classification"><Badge tone={classification.kind === "classified" ? "warning" : "neutral"}>{classification.kind === "classified" ? TRIAGE[classification.category].label : "Category pending"}</Badge><ArrowUpRight size={16} /><small>{classification.kind === "classified" ? "Matched from reported observations" : "No assumption before an answer"}</small></div></div>
          <div><span className="outreach-eyebrow">02 / RELEVANT QUESTIONS</span>{classification.kind === "classified" ? TRIAGE[classification.category].questions.map((question, index) => {
            const questionTurn = current.turns.find(turn => turn.speaker === "agent" && turn.text === question);
            const asked = questionTurn && session.elapsed >= questionTurn.end;
            const active = questionTurn && session.elapsed >= questionTurn.start && session.elapsed < questionTurn.end;
            return <div key={question} className={`outreach-question ${asked ? "asked" : ""} ${active ? "asking" : ""}`}><span>{asked ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</span>{question}{active && <b>ASKING</b>}</div>;
          }) : <p className="outreach-pending">The question path appears after the resident's first description. Mobility, household size and oxygen needs follow.</p>}</div></div>
        </Card></div>
        <Card label="Live speech stream" className="outreach-panel outreach-conversation" style={{ padding: 0 }}><div className="outreach-panel-heading"><div><Headphones size={16} /><h2>Live speech stream</h2></div><button className="outreach-icon" aria-label={audio ? "Mute agent audio" : "Enable agent audio"} title="Read the selected agent’s responses aloud" onClick={() => setAudio(value => !value)}>{audio ? <Volume2 size={16} /> : <VolumeX size={16} />}</button></div>
          <div className="outreach-resident"><span className="outreach-avatar">{current.name.split(" ").map(s => s[0]).join("")}</span><div><strong>{current.name}</strong><small>HH-{String(current.id + 1).padStart(3, "0")} · {current.address}</small></div><span style={{ color: PHASE_COLOR[phase] }} className="outreach-call-phase">{PHASE_LABEL[phase]}</span></div>
          <div className="outreach-stream-tabs"><Tabs items={[{ id: "conversation", label: "Conversation" }, { id: "events", label: "All calls", count: events.length }]} activeId={tab} onChange={id => { if (id === "conversation" || id === "events") setTab(id); }} /></div>
          <div className="outreach-transcript" ref={transcript} role="log" aria-live="off" aria-label={tab === "conversation" ? "Selected household speech transcript" : "All call events"}>
            {tab === "conversation" ? <>{!turns.length && <div className="outreach-stream-empty"><Radio size={30} /><strong>{phase === "door_check" ? "No answer. Never marked safe." : phase === "ringing" ? "Calling this household…" : "A conversation starts with a connection."}</strong><p>{phase === "door_check" ? "This household is flagged for a physical welfare check." : "Launch outreach to follow household conversations in real time."}</p></div>}
              {turns.map(turn => <div className={`outreach-turn ${turn.speaker}`} key={turn.start}><div><span><i />{SPEAKERS[turn.speaker]}</span><time>{clock(turn.start)}</time></div><p>{turn.text}{!turn.final && <span className={`outreach-cursor ${running ? "" : "paused"}`} />}</p><small>{turn.final ? "Final" : running ? turn.speaker === "agent" ? "Synthesizing…" : "Transcribing…" : "Paused"}{turn.speaker === "dispatcher" ? " · dispatcher connected" : ""}</small></div>)}</> : <div className="outreach-events">{[...events.slice(0, 80)].reverse().map(event => <button key={`${event.call.id}-${event.at}-${event.label}`} onClick={() => { setSession(s => ({ ...s, selected: event.call.id })); setTab("conversation"); }}><time>{clock(event.at)}</time><div><strong>HH-{String(event.call.id + 1).padStart(3, "0")} <span>{event.label}</span></strong><p>{event.text}</p></div></button>)}</div>}
          </div><div className="outreach-stream-footer"><span><i />{running ? "Speech stream active" : "Speech stream paused"}</span><button onClick={exportLogs} aria-label="Export call logs"><Download size={13} /> Export logs</button></div>
        </Card>
      </div>
      {storage && <p className="outreach-storage" role="status">{storage}</p>}
    </div>
  </div>;
}
