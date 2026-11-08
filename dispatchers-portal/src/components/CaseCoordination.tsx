import React from "react";
import type { Call, CallHandoff, DispatchRoute, RouteGuidance, Message } from "../module_bindings/types";
import { parseRouteSteps, routeMatchesLocations, type RouteStep } from "../../../shared/route-guidance";
import { coordinateText } from "./PickupLocation";
import type { CaseRow } from "../lib/cases";
import type { Command } from "../commands";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { Facts, Quiet, Section, clock, millis } from "./CaseFileParts";
import { words } from "./EmergencyFeed";

type BadgeTone = React.ComponentProps<typeof Badge>["tone"];

const METERS_PER_MILE = 1609.344;

const ROUTE_BUTTON: Record<string, string> = {
  pending: "Calculating route",
  ready: "Refresh route",
  failed: "Try route again",
};

export const RoadRoute: React.FC<{
  row: CaseRow;
  route?: DispatchRoute;
  guidance?: RouteGuidance;
  disabled: boolean;
  send: (command: Command) => void;
}> = ({ row, route, guidance, disabled, send }) => {
  const { assignment, match } = row;
  if (!assignment) return null;
  const unit = match?.vehicle;
  const stale = route && unit && !routeMatchesLocations(route, unit, row.household);
  const usable = route?.state === "ready" && !stale;
  const currentGuidance = usable && guidance?.revision === route.revision ? guidance : undefined;
  let steps: RouteStep[] = [];
  try { if (currentGuidance) steps = parseRouteSteps(JSON.parse(currentGuidance.stepsJson)); } catch { /* Keep the valid road route visible. */ }

  return (
    <Section title="Road route">
      {route && <Facts rows={[["Responder coordinates", coordinateText({ lat: route.originLat, lng: route.originLng })], ["Resident coordinates", coordinateText({ lat: route.destinationLat, lng: route.destinationLng })]]} />}
      {stale && <p role="alert" style={{ color: "#e8b84b", fontSize: 12 }}>Responder or resident location changed. Refresh the route to get current directions.</p>}
      {usable && route.distanceMeters !== undefined && route.durationSeconds !== undefined && (
        <Facts
          rows={[
            ["Distance", `${(route.distanceMeters / METERS_PER_MILE).toFixed(1)} miles`],
            ["Drive time", `${Math.round(route.durationSeconds / 60)} min`],
            ["Calculated", clock(millis(route.updatedAt))],
          ]}
        />
      )}
      {usable && (
        <p style={{ margin: "8px 0 0", fontSize: 11.5, lineHeight: 1.45, color: "#9a9aa0" }}>
          From OSRM's road network, with no live traffic or hazard data. A path through a reported closure is rejected, not rerouted.
        </p>
      )}
      {usable && currentGuidance?.state === "ready" && <div style={{ marginTop: 12 }}><h4 style={{ margin: "0 0 6px", fontSize: 13 }}>Gemini route brief</h4><p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>{currentGuidance.summary}</p><p style={{ margin: "4px 0", color: "#9a9aa0", fontSize: 11 }}>{currentGuidance.model} · verify conditions before travel</p></div>}
      {usable && !currentGuidance && <Quiet>Preparing Gemini guidance and turn-by-turn directions…</Quiet>}
      {currentGuidance?.state === "failed" && <Quiet>{currentGuidance.error ?? "Gemini guidance unavailable."}</Quiet>}
      {steps.length > 0 && <details style={{ marginTop: 12 }} open><summary style={{ cursor: "pointer", fontSize: 13 }}>Driving directions ({steps.length} steps)</summary><ol style={{ paddingLeft: 20, fontSize: 12.5, lineHeight: 1.5 }}>{steps.map((step, index) => <li key={index} style={{ marginBottom: 8 }}>{step.instruction}<span style={{ color: "#9a9aa0" }}> · {Math.round(step.distanceMeters)} m</span></li>)}</ol></details>}
      {route?.state === "failed" && <p style={{ margin: 0, fontSize: 12.5, color: "#f87171" }}>{route.failureReason ?? "No road route was returned."}</p>}
      {!route && <Quiet>No route calculated for {unit?.name ?? "this unit"} yet.</Quiet>}
      <div style={{ marginTop: 10 }}>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || route?.state === "pending" && !stale}
          onClick={() => send({ kind: "route", assignmentId: assignment.id })}
        >
          {stale ? "Refresh route" : (route && ROUTE_BUTTON[route.state]) ?? "Get road route"}
        </Button>
      </div>
    </Section>
  );
};

const NOTICE_REQUEST_STATUS = ["driver_accepted", "en_route"];

export const ResidentNotice: React.FC<{
  row: CaseRow;
  messages: readonly Message[];
  disabled: boolean;
  send: (command: Command) => void;
}> = ({ row, messages, disabled, send }) => {
  const { household, request, assignment } = row;
  if (!request || assignment?.status !== "accepted" || !NOTICE_REQUEST_STATUS.includes(request.status)) return null;

  // Accepting already queues this text, so the button only appears when this assignment has none.
  const acceptedAt = assignment.decidedAt ? millis(assignment.decidedAt) : 0;
  const notice = messages
    .filter((m) => m.householdId === household.id && m.direction === "out" && NOTICE_REQUEST_STATUS.includes(m.requestStatus ?? "") && millis(m.at) >= acceptedAt)
    .sort((a, b) => millis(b.at) - millis(a.at))[0];

  return (
    <Section title="Resident notice">
      {notice ? (
        <>
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <Badge tone={notice.state === "failed" ? "danger" : notice.state === "sent" ? "success" : "warning"}>{words(notice.state)}</Badge>
            <time style={{ fontSize: 11, color: "#9a9aa0", fontVariantNumeric: "tabular-nums" }}>{clock(millis(notice.at))}</time>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "#c2c2c9", overflowWrap: "anywhere" }}>{notice.body}</p>
          {notice.error && <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#f87171", overflowWrap: "anywhere" }}>{notice.error}</p>}
        </>
      ) : (
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => send({ kind: "notify", requestId: request.id })}>
          Text resident we're coming
        </Button>
      )}
    </Section>
  );
};

const HANDOFF: Record<string, { label: string; tone: BadgeTone }> = {
  requested: { label: "Transfer requested", tone: "warning" },
  ringing: { label: "Dispatcher ringing", tone: "warning" },
  connected: { label: "Connected to dispatcher", tone: "success" },
  failed: { label: "Transfer failed", tone: "danger" },
};

export const HumanHandoff: React.FC<{ calls: readonly Call[]; handoffs: readonly CallHandoff[] }> = ({ calls, handoffs }) => {
  const handoff = handoffs
    .filter((h) => calls.some((c) => c.id === h.callId))
    .sort((a, b) => millis(b.requestedAt) - millis(a.requestedAt))[0];

  if (!handoff) {
    if (!calls.some((c) => c.phase === "live")) return null;
    return (
      <Section title="Human handoff">
        <Quiet>The phone agent transfers this call to a dispatcher once the resident agrees. No transfer has been requested yet.</Quiet>
      </Section>
    );
  }

  const shown = HANDOFF[handoff.status] ?? { label: words(handoff.status), tone: "neutral" as const };
  return (
    <Section title="Human handoff">
      <div style={{ marginBottom: 8 }}>
        <Badge tone={shown.tone}>{shown.label}</Badge>
      </div>
      <Facts
        rows={[
          ["To", handoff.targetLabel],
          ["Requested", clock(millis(handoff.requestedAt))],
          ["Updated", clock(millis(handoff.updatedAt))],
        ]}
      />
      {handoff.failureReason && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#f87171", overflowWrap: "anywhere" }}>{handoff.failureReason}</p>}
      {handoff.detail && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#c2c2c9", overflowWrap: "anywhere" }}>{handoff.detail}</p>}
      {handoff.status === "requested" && (
        <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "#9a9aa0" }}>Nothing yet confirms that the dispatcher answered.</p>
      )}
    </Section>
  );
};
