import React, { useEffect, useMemo, useRef } from "react";
import { X, Bot, User, PhoneCall, MessageSquare, Users, Clock } from "lucide-react";
import type { Call, CallHandoff, CallRecord, CallAnalysis, Correction, DispatchRoute, RouteGuidance, Message, TranscriptLine, Zone } from "../module_bindings/types";
import { PickupLocation } from "./PickupLocation";
import { ClaudeReview } from "./CallInbox";
import type { CaseRow } from "../lib/cases";
import { transcriptsForHousehold } from "../lib/data";
import type { Command } from "../commands";
import { Badge } from "../design-system/Badge";
import { EmptyState } from "../design-system/EmptyState";
import { ACCOUNT, CaseActions, words } from "./EmergencyFeed";
import { Facts, Quiet, Section, clock, millis } from "./CaseFileParts";
import { HumanHandoff, ResidentNotice, RoadRoute } from "./CaseCoordination";

interface CaseFileProps {
  row: CaseRow;
  zone?: Zone;
  calls: readonly Call[];
  messages: readonly Message[];
  corrections: readonly Correction[];
  transcripts: readonly TranscriptLine[];
  callRecords?: readonly CallRecord[];
  callAnalyses?: readonly CallAnalysis[];
  handoffs: readonly CallHandoff[];
  route?: DispatchRoute;
  guidance?: RouteGuidance;
  disabled: boolean;
  onCommand: (householdId: bigint, command: Command) => void;
  onClose: () => void;
}

type Contact =
  | { kind: "call"; at: number; call: Call }
  | { kind: "message"; at: number; message: Message };

const OPEN_CALL = ["queued", "ringing", "live"];

function callLine(call: Call) {
  const parts = [`${words(call.purpose)} call`, `attempt ${call.attempt}`, words(call.phase)];
  if (call.outcome) parts.push(words(call.outcome));
  return parts.join(" · ");
}

export const CASE_FILE_WIDTH = 460;

export const CaseFile: React.FC<CaseFileProps> = ({
  row,
  zone,
  calls,
  messages,
  corrections,
  transcripts,
  callRecords = [],
  callAnalyses = [],
  handoffs,
  route,
  guidance,
  disabled,
  onCommand,
  onClose,
}) => {
  const { household, request, assignment, match, account } = row;
  const needs = request ?? household;

  const homeCalls = useMemo(() => calls.filter((c) => c.householdId === household.id), [calls, household.id]);
  const contacts = useMemo<Contact[]>(
    () =>
      [
        ...homeCalls.map((call): Contact => ({ kind: "call", at: millis(call.queuedAt), call })),
        ...messages.filter((m) => m.householdId === household.id).map((message): Contact => ({ kind: "message", at: millis(message.at), message })),
      ].sort((a, b) => a.at - b.at),
    [homeCalls, messages, household.id]
  );
  const conversation = useMemo(
    () => [...transcriptsForHousehold(transcripts, calls, household.id)].sort((a, b) => millis(a.at) - millis(b.at)),
    [transcripts, calls, household.id]
  );
  const changes = useMemo(() => corrections.filter((c) => c.householdId === household.id), [corrections, household.id]);
  const openCall = homeCalls.find((c) => OPEN_CALL.includes(c.phase));
  const send = (command: Command) => onCommand(household.id, command);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Follow a live call as lines arrive, unless the dispatcher has scrolled up to reread something.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && openCall && pinned.current) el.scrollTop = el.scrollHeight;
  }, [conversation.length, openCall]);

  return (
    <aside
      role="dialog"
      aria-label={`Case file for ${household.name}`}
      className="fixed flex flex-col"
      style={{
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        width: `min(${CASE_FILE_WIDTH}px, 100vw)`,
        background: "#131316",
        borderLeft: "1px solid #26262c",
        boxShadow: "0 16px 48px rgb(0 0 0 / 55%)",
      }}
    >
      <header className="flex items-start justify-between gap-3" style={{ padding: 16, borderBottom: "1px solid #26262c" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#9a9aa0", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Queue <span style={{ opacity: 0.5 }}> / </span> <span style={{ color: "#c2c2c9" }}>{household.name}</span>
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em", color: "#f5f5f6", margin: 0, overflowWrap: "anywhere" }}>{household.name}</h2>
          <p style={{ fontSize: 12, color: "#9a9aa0", margin: "3px 0 8px", overflowWrap: "anywhere" }}>
            {household.address} · {household.phone}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {household.simulated && <Badge tone="neutral">Simulated</Badge>}
            <Badge tone={ACCOUNT[account].tone}>{ACCOUNT[account].label}</Badge>
            {openCall && (
              <Badge tone={openCall.phase === "live" ? "danger" : "warning"} dot>
                {openCall.phase === "live" ? "On call now" : `Call ${words(openCall.phase)}`}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 flex-wrap" style={{ marginTop: 10, fontSize: 12, color: "#c2c2c9" }}>
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 shrink-0" style={{ color: "#9a9aa0" }} />
              {needs.people} {needs.people === 1 ? "occupant" : "occupants"} · {words(needs.mobility)}
            </span>
            {household.hazardAt && (
              <span className="flex items-center gap-1.5" style={{ fontVariantNumeric: "tabular-nums" }}>
                <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: "#9a9aa0" }} />
                Hazard {clock(millis(household.hazardAt))}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close case file"
          style={{ padding: 6, borderRadius: 8, background: "transparent", border: "none", color: "#9a9aa0", cursor: "pointer" }}
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div style={{ padding: "10px 16px", borderBottom: "1px solid #26262c" }}>
        <CaseActions row={row} disabled={disabled} send={send} fallback={<Quiet>No action is waiting on this case.</Quiet>} />
      </div>

      <div
        ref={scroller}
        className="flex-1 overflow-y-auto"
        style={{ minHeight: 0, paddingBottom: 12 }}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        <PickupLocation resident={household} responder={assignment ? match?.vehicle : undefined} />
        <Section title="Summary">
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "#f5f5f6", overflowWrap: "anywhere" }}>{row.summary}</p>
        </Section>
        {[...callRecords].filter(c => c.householdId === household.id).sort((a, b) => Number(b.recordedAt.toMillis() - a.recordedAt.toMillis())).slice(0, 1).map(record =>
          <Section key={record.providerId} title="Latest call analysis"><ClaudeReview record={record} analysis={callAnalyses.find(a => a.providerId === record.providerId)} /></Section>)}

        <Section title="Location and hazard">
          <Facts
            rows={[
              ["Address", household.address],
              ["Coordinates", `${household.lat.toFixed(5)}, ${household.lng.toFixed(5)}`],
              ["In hazard zone", household.inZone ? "Yes" : "No"],
              ["Incident", zone ? zone.headline ?? zone.name : "No incident active"],
              ...(zone ? ([["Hazard", zone.event]] as [string, React.ReactNode][]) : []),
              ["Hazard reaches home", household.hazardAt ? clock(millis(household.hazardAt)) : "Not estimated"],
            ]}
          />
        </Section>

        <Section title="Assistance needs">
          <Facts
            rows={[
              ["Occupants", needs.people],
              ["Mobility", words(needs.mobility)],
              ["Assistance", words(needs.assistance)],
              ["Oxygen", needs.oxygen ? "Required" : "No"],
              ["Can leave alone", household.canLeave === undefined ? "Unconfirmed" : household.canLeave ? "Yes" : "No"],
              ["Language", household.language],
            ]}
          />
        </Section>

        <Section title="Rescue resources">
          {assignment && match ? (
            <Facts
              rows={[
                ["Unit", `${match.vehicle.name} (${match.vehicle.kind})`],
                ["Driver", match.vehicle.driverName],
                ["Status", words(assignment.status)],
                ["ETA", `${assignment.etaMinutes} min`],
                ["Stop", assignment.stopOrder],
              ]}
            />
          ) : match?.canServe ? (
            <Quiet>
              No unit assigned. Closest capable unit is {match.vehicle.name}, {match.distanceMiles} miles away, about {match.etaMinutes} min.
            </Quiet>
          ) : (
            <Quiet>No unit assigned.</Quiet>
          )}
        </Section>

        <RoadRoute row={row} route={route} guidance={guidance} disabled={disabled} send={send} />
        <ResidentNotice row={row} messages={messages} disabled={disabled} send={send} />
        <HumanHandoff calls={homeCalls} handoffs={handoffs} />

        <Section title="Contact attempts">
          {contacts.length === 0 ? (
            <Quiet>No contact attempted yet.</Quiet>
          ) : (
            <ol className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {contacts.map((contact) => (
                <li key={`${contact.kind}-${contact.kind === "call" ? contact.call.id : contact.message.id}`} className="flex gap-2" style={{ fontSize: 12.5 }}>
                  {contact.kind === "call" ? (
                    <PhoneCall className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2, color: "#9a9aa0" }} />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2, color: "#9a9aa0" }} />
                  )}
                  <div style={{ minWidth: 0, flex: 1, color: "#f5f5f6", overflowWrap: "anywhere" }}>
                    {contact.kind === "call" ? (
                      <span className="capitalize">{callLine(contact.call)}</span>
                    ) : (
                      <>
                        <span>{contact.message.direction === "in" ? "Text from resident" : "Text to resident"} · {words(contact.message.state)}</span>
                        <div style={{ color: "#c2c2c9" }}>{contact.message.body}</div>
                        {contact.message.error && <div style={{ color: "#f87171" }}>{contact.message.error}</div>}
                      </>
                    )}
                  </div>
                  <time style={{ fontSize: 11, color: "#9a9aa0", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{clock(contact.at)}</time>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {changes.length > 0 && (
          <Section title="Record changes">
            <ul className="flex flex-col gap-1" style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12.5, color: "#f5f5f6" }}>
              {changes.map((change) => (
                <li key={String(change.id)} style={{ overflowWrap: "anywhere" }}>
                  <span className="capitalize">{words(change.field)}</span>: {change.before} → {change.after}{" "}
                  <span style={{ color: "#9a9aa0" }}>({words(change.source)})</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Resident responses">
          {conversation.length === 0 ? (
            <EmptyState
              title="No conversation recorded for this household."
              detail={household.simulated ? "Simulated homes answer without a voice conversation, so they have no transcript." : "Lines appear here as soon as the voice service records them."}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {conversation.map((line) => {
                const isAgent = line.speaker === "agent";
                return (
                  <div key={String(line.id)} className="flex gap-2" style={{ flexDirection: isAgent ? "row" : "row-reverse", fontSize: 13 }}>
                    <div
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 7,
                        background: isAgent ? "rgb(143 176 255 / 14%)" : "rgb(61 214 140 / 14%)",
                        color: isAgent ? "#8fb0ff" : "#3dd68c",
                      }}
                    >
                      {isAgent ? <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                    </div>
                    <div
                      style={{
                        maxWidth: "82%",
                        borderRadius: "12px",
                        padding: "7px 10px",
                        background: isAgent ? "#1a1a1f" : "rgb(61 214 140 / 14%)",
                        color: "#f5f5f6",
                      }}
                    >
                      <p className="whitespace-pre-wrap" style={{ margin: 0, lineHeight: 1.45, overflowWrap: "anywhere" }}>{line.text}</p>
                      <time style={{ fontSize: 10, color: "#9a9aa0", fontVariantNumeric: "tabular-nums" }}>{clock(millis(line.at))}</time>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
};
