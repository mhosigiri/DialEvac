import React, { useState } from "react";
import type { CallRecord, CallAnalysis, Household } from "../module_bindings/types";
import { parseCallAnalysis } from "../../../shared/call-analysis";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";

export function ClaudeReview({ record, analysis, onRetry, disabled = false }: { record: CallRecord; analysis?: CallAnalysis; onRetry?: (id: string) => void; disabled?: boolean }) {
  let result;
  if (analysis?.state === "ready" && analysis.revision === record.revision && analysis.resultJson) {
    try { result = parseCallAnalysis(JSON.parse(analysis.resultJson), record.turns); } catch { /* Retain transcript if an analysis cannot be read. */ }
  }
  return <section aria-label="Claude call analysis" style={{ padding: 16, border: "1px solid #303038", borderRadius: 12, background: "#17171d" }}>
    <div className="flex items-center justify-between gap-2"><h3 style={{ margin: 0, fontSize: 15 }}>Claude analysis</h3>
      <Badge tone={result?.priority === "critical" ? "danger" : result ? "success" : analysis?.state === "failed" ? "danger" : "warning"}>{result ? result.priority : analysis?.state?.replace(/_/g, " ") ?? "Waiting"}</Badge></div>
    {result ? <>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>{result.summary}</p>
      <p style={{ color: "#c2c2c9", fontSize: 13 }}><strong>Priority:</strong> {result.priorityReason}</p>
      {result.facts.length > 0 && <><h4>Evidence from the call</h4><ul style={{ paddingLeft: 20 }}>{result.facts.map((fact, i) => <li key={i} style={{ marginBottom: 10, fontSize: 13 }}>
        {fact.fact}<blockquote style={{ color: "#9a9aa0", margin: "4px 0" }}>“{fact.quote}” — {record.turns[fact.turn].speaker}, turn {fact.turn + 1}</blockquote>
      </li>)}</ul></>}
      {result.unknowns.length > 0 && <><h4>Confirm with the caller</h4><ul style={{ paddingLeft: 20 }}>{result.unknowns.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
      {result.recommendedActions.length > 0 && <><h4>Suggested next steps</h4><ul style={{ paddingLeft: 20 }}>{result.recommendedActions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
      <p style={{ fontSize: 11, color: "#9a9aa0", marginBottom: 0 }}>AI analysis for dispatcher review · {analysis?.model}. Verify facts against the recording/transcript before acting.</p>
    </> : <p style={{ color: "#9a9aa0", fontSize: 13 }}>{record.status === "processing" ? "Call in progress or awaiting the provider's final transcript." : analysis?.state === "failed" ? analysis.error ?? "Analysis failed; automatic retry scheduled." : analysis?.state === "no_transcript" ? "The provider returned no spoken transcript for this call." : "The transcript is saved. Claude analysis will appear here when ready."}</p>}
    {analysis?.state === "failed" && onRetry && <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onRetry(record.providerId)}>Retry Claude analysis</Button>}
  </section>;
}

export function CallInbox({ records, analyses, households, onOpenCase, onRetry, disabled }: {
  records: readonly CallRecord[]; analyses: readonly CallAnalysis[]; households: readonly Household[];
  onOpenCase: (id: bigint) => void; onRetry: (id: string) => void; disabled: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const sorted = [...records].sort((a, b) => Number((b.startedAt ?? b.recordedAt).toMillis() - (a.startedAt ?? a.recordedAt).toMillis()));
  const current = sorted.find(row => row.providerId === selected) ?? sorted[0];
  const home = current?.householdId === undefined ? undefined : households.find(h => h.id === current.householdId);
  return <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ paddingTop: 16 }}>
    <section aria-label="Recorded calls"><h2 style={{ marginTop: 0 }}>Call inbox <span style={{ color: "#9a9aa0" }}>({records.length})</span></h2>
      <p style={{ color: "#9a9aa0", fontSize: 13 }}>All provider calls, including unmatched callers and failed calls.</p>
      {!records.length && <p>No calls have been imported yet.</p>}
      {sorted.map(row => <button key={row.providerId} onClick={() => setSelected(row.providerId)} aria-pressed={row.providerId === current?.providerId}
        style={{ display: "block", width: "100%", textAlign: "left", padding: 14, marginBottom: 8, borderRadius: 10, background: row.providerId === current?.providerId ? "#252530" : "#131316", border: "1px solid #303038", color: "#f5f5f6", cursor: "pointer" }}>
        <strong>{row.callerLabel}</strong><span style={{ float: "right", color: "#9a9aa0" }}>{row.direction}</span>
        <div style={{ fontSize: 12, color: "#9a9aa0", marginTop: 6 }}>{new Date(Number((row.startedAt ?? row.recordedAt).toMillis())).toLocaleString()} · {row.status} · {row.turns.length} turns</div>
        {row.householdId === undefined && <div style={{ marginTop: 5, color: "#e8b84b", fontSize: 12 }}>Caller needs identification</div>}
      </button>)}
    </section>
    {current && <section className="lg:col-span-2" style={{ minWidth: 0 }}>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: 14 }}><div><h2 style={{ margin: 0 }}>{home?.name ?? current.callerLabel}</h2><p style={{ color: "#9a9aa0", fontSize: 12, overflowWrap: "anywhere" }}>{current.providerId}{current.durationSeconds !== undefined ? ` · ${Math.round(current.durationSeconds)} seconds` : ""}</p></div>
        {home && <Button size="sm" variant="secondary" onClick={() => onOpenCase(home.id)}>Open case</Button>}</div>
      <ClaudeReview record={current} analysis={analyses.find(a => a.providerId === current.providerId)} onRetry={onRetry} disabled={disabled} />
      <h3>Original transcript</h3>
      {!current.turns.length && <p style={{ color: "#9a9aa0" }}>No spoken transcript was returned by the provider.</p>}
      <ol style={{ listStyle: "none", padding: 0 }}>{current.turns.map((turn, i) => <li key={i} style={{ borderLeft: `2px solid ${turn.speaker === "resident" ? "#3dd68c" : "#8fb0ff"}`, padding: "8px 12px", marginBottom: 8, background: "#131316", borderRadius: 6 }}>
        <div style={{ fontSize: 11, color: "#9a9aa0", marginBottom: 4 }}>{i + 1} · {turn.speaker === "resident" ? "Caller" : "Agent"}</div><p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{turn.text}</p>
      </li>)}</ol>
    </section>}
  </div>;
}
