import React, { useState } from "react";
import { Radio, DoorOpen, Users } from "lucide-react";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { Card, CardHeader, CardDivider } from "./Card";
import { Tabs } from "./Tabs";
import { SearchBar } from "./SearchBar";
import { PageHeader } from "./PageHeader";
import { Notice } from "./Notice";
import { CaseCard } from "./CaseCard";
import { CoverageBar } from "./CoverageBar";
import type { CoverageSegment } from "./CoverageBar";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";

/**
 * Visual test page. Rendered when the URL has ?showcase
 * (e.g. http://127.0.0.1:3001/?showcase). Mock props only —
 * never connects to the database.
 */

const COVERAGE_ALARM: CoverageSegment[] = [
  { key: "leaving", label: "Leaving on own", value: 41, tone: "success" },
  { key: "helped", label: "Helped", value: 28, tone: "success" },
  { key: "requested", label: "Help requested", value: 19, tone: "info" },
  { key: "escalated", label: "Escalated", value: 6, tone: "warning" },
  { key: "doorcheck", label: "Door check", value: 9, tone: "info" },
  { key: "reaching", label: "Reaching", value: 3, tone: "neutral" },
  { key: "overlooked", label: "Overlooked", value: 2, tone: "danger" },
];

const COVERAGE_CALM: CoverageSegment[] = [
  { key: "leaving", label: "Leaving on own", value: 41, tone: "success" },
  { key: "helped", label: "Helped", value: 28, tone: "success" },
  { key: "requested", label: "Help requested", value: 19, tone: "info" },
  { key: "escalated", label: "Escalated", value: 6, tone: "warning" },
  { key: "doorcheck", label: "Door check", value: 9, tone: "info" },
  { key: "reaching", label: "Reaching", value: 5, tone: "neutral" },
  { key: "overlooked", label: "Overlooked", value: 0, tone: "danger" },
];

const noop = () => {};

export const DesignSystemShowcase: React.FC = () => {
  const [tab, setTab] = useState("all");
  const [activeSeg, setActiveSeg] = useState<string | undefined>("overlooked");
  const [calmSeg, setCalmSeg] = useState<string | undefined>(undefined);
  const [selectedCase, setSelectedCase] = useState<string | null>("oxygen");
  const [showNotice, setShowNotice] = useState(true);

  const queueCard = (
    id: string,
    props: React.ComponentProps<typeof CaseCard>,
  ) => (
    <CaseCard
      {...props}
      selected={selectedCase === id}
      onSelect={() => setSelectedCase(selectedCase === id ? null : id)}
    />
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060607",
        color: "#f5f5f6",
        padding: "28px 28px 96px",
        fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div style={{ maxWidth: 1240, margin: "0 auto" }}>
        <PageHeader
          title="Zone 4 — Riverside evacuation queue"
          status={<Badge tone="danger" dot>2 critical</Badge>}
          description="Storm surge warning to 18:00 · 108 homes in zone · next transport wave 14:30"
          actions={
            <>
              <Button variant="secondary" size="sm">All units</Button>
              <Button variant="primary" size="sm">Assign next case</Button>
            </>
          }
        />

        <div style={{ marginTop: 14 }}>
          <Tabs
            items={[
              { id: "all", label: "All" },
              { id: "critical", label: "Critical", count: 2 },
              { id: "oxygen", label: "Oxygen dependent" },
              { id: "doorcheck", label: "Door checks" },
            ]}
            activeId={tab}
            onChange={setTab}
          />
        </div>

        {/* Coverage promise */}
        <div style={{ marginTop: 20, marginBottom: 8, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9a9aa0" }}>
          Coverage — no one is overlooked
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <Card label="Coverage with overlooked homes">
            <CardHeader title="Zone coverage" subtitle="Overlooked excluded: 106 of 108 accounted" />
            <CoverageBar segments={COVERAGE_ALARM} total={108} activeKey={activeSeg} onSelect={setActiveSeg} />
          </Card>
          <Card label="Coverage all accounted">
            <CardHeader title="Zone coverage" subtitle="Overlooked at zero — calm" />
            <CoverageBar segments={COVERAGE_CALM} total={108} activeKey={calmSeg} onSelect={setCalmSeg} />
          </Card>
        </div>

        {/* Queue density lab */}
        <div style={{ marginTop: 28, marginBottom: 8, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9a9aa0" }}>
          Queue density — 5-column panel, 700px tall, no scrolling needed for 4+ cards
        </div>
        <div className="ds-queue-grid">
          <div
            id="queue-density-panel"
            style={{
              height: 700,
              overflow: "hidden",
              background: "#060607",
              border: "1px solid #26262c",
              borderRadius: "16px",
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {queueCard("oxygen", {
              severity: "critical",
              title: "Mariam Haddad — oxygen concentrator",
              subtitle: "14 Willow Creek Ln, Apt 3B · Riverside",
              meta: <span>2 occupants · O₂ · 2 hrs battery</span>,
              badges: <Badge tone="danger" dot>Oxygen</Badge>,
              match: <span style={{ fontSize: 12, color: "#9a9aa0" }}>Unit 7 · 6 min</span>,
              summary: "Called twice, no answer. Last check-in 11:20. Concentrator battery rated to 13:30.",
              actions: <Button variant="primary" size="sm" onClick={noop}>Dispatch</Button>,
            })}
            {queueCard("escalated", {
              severity: "critical",
              title: "Rising water — Cedar Row basements",
              subtitle: "Cedar Row 2–18, basement flats · Riverside",
              meta: <span>9 occupants · water at doorstep</span>,
              badges: <Badge tone="warning" dot>Escalated</Badge>,
              match: <span style={{ fontSize: 12, color: "#9a9aa0" }}>Unit 2 · 4 min</span>,
              actions: <Button variant="primary" size="sm" onClick={noop}>Dispatch</Button>,
            })}
            {queueCard("shelter", {
              severity: "high",
              title: "Northgate accommodation — Block B",
              subtitle: "Northgate Works Hostel, Block B",
              meta: <span><Users size={13} style={{ verticalAlign: -2 }} /> 40 occupants · 3 buses needed</span>,
              badges: <Badge tone="warning">3 buses</Badge>,
              match: <span style={{ fontSize: 12, color: "#9a9aa0" }}>Staging · 20 min</span>,
              actions: <Button variant="secondary" size="sm" onClick={noop}>Plan</Button>,
            })}
            {queueCard("wheelchair", {
              severity: "high",
              title: "Jonas Weber — wheelchair user",
              subtitle: "8 Harbor View Terrace, ground floor",
              meta: <span>1 occupant · needs lift van</span>,
              badges: <Badge tone="neutral">Lift van</Badge>,
              match: <span style={{ fontSize: 12, color: "#9a9aa0" }}>Unit 3 · 11 min</span>,
              actions: <Button variant="secondary" size="sm" onClick={noop}>Assign</Button>,
            })}
            {queueCard("doorcheck", {
              severity: "medium",
              title: "Flat 12, Meridian Court — door check",
              subtitle: "Meridian Court, Flat 12 · no answer on radio",
              meta: <span><DoorOpen size={13} style={{ verticalAlign: -2 }} /> 1 occupant · verify presence</span>,
              badges: <Badge tone="info">Door check</Badge>,
              match: <span style={{ fontSize: 12, color: "#9a9aa0" }}>Pending visit</span>,
            })}
            {queueCard("closed", {
              severity: "low",
              resolved: true,
              title: "Aisha Bello — evacuated 09:40",
              subtitle: "3 Lantern Quay · shelter Northgate",
              meta: <span>4 occupants · closed 09:40</span>,
              badges: <Badge tone="success">Evacuated</Badge>,
            })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <Card label="Severity states">
              <CardHeader title="Severity reads without color" subtitle="Icon + word + marker bar — check the grayscale shot" />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <CaseCard severity="critical" title="Critical — oxygen dependent, unresponsive" subtitle="14 Willow Creek Ln, Apt 3B" meta={<span>2 occupants</span>} />
                <CaseCard severity="high" title="High — escalated, water rising" subtitle="Cedar Row basement flats" meta={<span>9 occupants</span>} />
                <CaseCard severity="doorcheck" title="Door check — field team needed" subtitle="Meridian Court, Flat 12" meta={<span>1 occupant</span>} />
                <CaseCard severity="medium" title="Medium — ride requested, unit en route" subtitle="Harbor View, Bldg 4" meta={<span>2 occupants</span>} />
                <CaseCard severity="low" title="Low — confirmed leaving on own" subtitle="22 Ferry Road" meta={<span>3 occupants</span>} />
              </div>
            </Card>
            <Card label="Truncation">
              <CardHeader title="Long names and addresses truncate" subtitle="Full text in the title tooltip" />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <CaseCard
                  severity="medium"
                  title="Alexandrina Konstantinou Papadopoulos-Vasiliou"
                  subtitle="Unit 1204, Tower C, Marina Promenade Residences, 77 Seawall Drive, Riverside North"
                  meta={<span>5 occupants · 1 infant</span>}
                />
              </div>
            </Card>
          </div>
        </div>

        {/* Empty / loading / failure */}
        <div style={{ marginTop: 28, marginBottom: 8, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9a9aa0" }}>
          Empty · loading · failure
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          <Card label="Empty queue">
            <EmptyState
              title="No cases match these filters"
              detail="Clear the severity filter or widen the zone to see more households."
            />
          </Card>
          <Card label="Loading queue">
            <CardHeader title="Loading households" subtitle="Skeleton respects reduced-motion" />
            <Skeleton lines={4} />
            <CardDivider />
            <Skeleton lines={1} height={32} />
          </Card>
          <Card label="Failed action notice">
            <CardHeader title="Notice" subtitle="Stays until dismissed" />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" onClick={() => setShowNotice(true)}>
                {showNotice ? "Notice visible (bottom-right)" : "Show notice again"}
              </Button>
            </div>
            <p style={{ fontSize: 12.5, color: "#9a9aa0", lineHeight: 1.55 }}>
              Demo: “Dispatch to Unit 7 failed — radio timeout. Retry from the case card.”
            </p>
          </Card>
        </div>

        {/* Compact controls */}
        <div style={{ marginTop: 28, marginBottom: 8, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9a9aa0" }}>
          Controls — hardcoded reference values
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          <Card label="Buttons">
            <CardHeader title="Buttons" subtitle="Reference values · natural width" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Button variant="primary" size="sm" onClick={noop}>Assign unit</Button>
              <Button variant="secondary" size="sm" onClick={noop}>Door check</Button>
              <Button variant="ghost" size="sm" onClick={noop}>Snooze</Button>
              <Button variant="danger" size="sm" onClick={noop}>Escalate</Button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
              <Button variant="secondary" size="sm" loading>Saving</Button>
              <Button variant="secondary" size="sm" disabled>Disabled</Button>
            </div>
          </Card>
          <Card label="Badges">
            <CardHeader title="Badges" subtitle="Red is critical-only; mobility uses neutral" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Badge tone="danger" dot>Critical · O₂</Badge>
              <Badge tone="warning" dot>Escalated</Badge>
              <Badge tone="info">Door check</Badge>
              <Badge tone="neutral"><Radio size={11} /> Lift van</Badge>
              <Badge tone="success">Evacuated</Badge>
              <Badge tone="neutral">Closed</Badge>
            </div>
            <CardDivider />
            <Tabs
              items={[
                { id: "all", label: "All" },
                { id: "critical", label: "Critical" },
                { id: "oxygen", label: "Oxygen" },
              ]}
              activeId={tab === "doorcheck" ? "all" : tab}
              onChange={setTab}
            />
          </Card>
          <Card label="Search">
            <CardHeader title="Search" subtitle="Name, street or unit" />
            <SearchBar placeholder="Search name, street or unit" aria-label="Search queue" />
          </Card>
        </div>
      </div>

      {showNotice && (
        <Notice
          message="Dispatch to Unit 7 failed — radio timeout. Retry from the case card."
          onDismiss={() => setShowNotice(false)}
        />
      )}
    </div>
  );
};
