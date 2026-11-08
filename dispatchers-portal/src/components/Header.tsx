import React, { useMemo } from "react";
import type { Assignment, Coverage, Vehicle, Zone } from "../module_bindings/types";
import type { CaseRow } from "../lib/cases";
import { isCleared } from "../queue";
import { SearchBar } from "../design-system/SearchBar";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { Card } from "../design-system/Card";
import { PageHeader } from "../design-system/PageHeader";
import { Stat } from "../design-system/Stat";
import { Tabs } from "../design-system/Tabs";
import { CoverageBar } from "../design-system/CoverageBar";
import type { CoverageSegment } from "../design-system/CoverageBar";
import type { FeedTab } from "./EmergencyFeed";
import { CopyIdentity } from "./OperatorIdentity";
import { Notifications } from "./Notifications";

interface HeaderProps {
  identity?: string;
  zone?: Zone;
  coverage?: Coverage;
  cases: readonly CaseRow[];
  assignments: readonly Assignment[];
  vehicles: readonly Vehicle[];
  connected: boolean;
  criticalCount: number;
  query: string;
  onQueryChange: (q: string) => void;
  onShowCritical: () => void;
  onOpenCase: (householdId: bigint) => void;
  activeTab: FeedTab;
  onTabChange: (t: FeedTab) => void;
  onAssignNext: () => void;
  onShowFleet: () => void;
  overview?: boolean;
  queue?: boolean;
}

function Lollipops({ counts }: { counts: { id: string; label: string; value: number; color: string; pill: boolean }[] }) {
  const max = Math.max(1, ...counts.map((c) => c.value));
  return (
    <div style={{ overflowX: "auto", overflowY: "hidden", margin: "0 -4px", padding: "0 4px 4px" }}>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, minHeight: 116, width: "max-content", minWidth: "100%", margin: "0 auto" }}>
      {counts.map((c) => {
        const h = c.value === 0 ? 12 : 24 + (c.value / max) * 56;
        const active = c.value === max && c.value > 0;
        return (
          <div key={c.id} style={{ flex: "1 0 96px", alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 6, minWidth: 0, background: active ? "#1a1a1f" : "transparent", borderRadius: 12, padding: "6px 0" }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: active ? "#0a0a0c" : "#f5f5f6",
                background: active ? "#f5f5f6" : "transparent",
                borderRadius: 999,
                padding: "3px 9px",
                marginBottom: 2,
              }}
            >
              {c.value}
            </span>
            <div style={{ height: 76, display: "flex", alignItems: "flex-end", width: "100%", justifyContent: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: h }}>
                <span style={{ width: 9, height: 9, borderRadius: 999, background: c.color, flexShrink: 0 }} />
                <span style={{ width: 2, flex: 1, background: active ? "#f5f5f6" : "#2e2e36", borderRadius: 2, marginTop: 2, opacity: active ? 0.9 : 0.7 }} />
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active ? "#0a0a0c" : "var(--ds-text-muted)",
                background: active ? "#f5f5f6" : "#1a1a1f",
                border: active ? "1px solid transparent" : "1px solid #26262c",
                borderRadius: 999,
                padding: "4px 10px",
                whiteSpace: "nowrap",
              }}
            >
              {c.label}
            </span>
          </div>
        );
      })}
      </div>
    </div>
  );
}

export const Header: React.FC<HeaderProps> = ({
  identity,
  zone,
  coverage,
  cases,
  assignments,
  vehicles,
  connected,
  criticalCount,
  query,
  onQueryChange,
  onShowCritical,
  onOpenCase,
  activeTab,
  onTabChange,
  onAssignNext,
  onShowFleet,
  overview = true,
  queue = false,
}) => {
  const stats = useMemo(() => {
    const open = cases.filter((c) => !isCleared(c));
    // Same severity rule as the queue cards: door_check accounts read as
    // doorcheck unless urgency is critical/high (which outranks). Exclusive.
    const sev = (c: CaseRow) =>
      isCleared(c) ? "cleared"
      : c.account === "door_check" && (c.urgency === "medium" || c.urgency === "low") ? "doorcheck"
      : c.urgency;
    const n = (s: string) => open.filter((c) => sev(c) === s).length;
    const cleared = cases.filter(isCleared).length;
    const door = cases.filter((c) => c.account === "door_check" && !isCleared(c)).length;
    const inTransit = assignments.filter((a) => a.status === "accepted").length;
    const offered = assignments.filter((a) => a.status === "offered").length;
    const inZone = coverage ? Number(coverage.inZone) : cases.length;
    const overlooked = coverage ? Number(coverage.overlooked) : 0;
    const accounted = Math.max(0, inZone - overlooked);
    const pct = inZone > 0 ? Math.round((accounted / inZone) * 100) : 100;
    return {
      open: open.length,
      critical: n("critical"),
      high: n("high"),
      doorcheck: n("doorcheck"),
      medium: n("medium"),
      low: n("low"),
      door, cleared, inTransit, offered, inZone, overlooked, accounted, pct,
    };
  }, [cases, assignments, coverage]);

  const segments: CoverageSegment[] | undefined = coverage
    ? [
        { key: "leaving", label: "Leaving on own", value: Number(coverage.leavingOnOwn), tone: "success" },
        { key: "helped", label: "Helped", value: Number(coverage.helped), tone: "success" },
        { key: "requested", label: "Help requested", value: Number(coverage.helpRequested), tone: "info" },
        { key: "escalated", label: "Escalated", value: Number(coverage.escalated), tone: "danger" },
        { key: "doorcheck", label: "Door check", value: Number(coverage.doorCheck), tone: "warning" },
        { key: "reaching", label: "Reaching", value: Number(coverage.reaching), tone: "neutral" },
        { key: "overlooked", label: "Overlooked", value: Number(coverage.overlooked), tone: "danger" },
      ]
    : undefined;

  const tabCounts: Record<FeedTab, number> = {
    all: cases.length,
    critical: cases.filter((c) => c.urgency === "critical" && !isCleared(c)).length,
    in_transit: stats.inTransit,
    door_check: stats.door,
    cleared: stats.cleared,
  };

  const description = zone?.name
    ? `${zone.name} · ${stats.inZone} ${stats.inZone === 1 ? "home" : "homes"} in zone${coverage ? ` · ${stats.accounted} accounted` : ""} · next transport wave on assignment`
    : `No active incident · EOC incident command · ${cases.length} households loaded`;

  return (
    <div className="px-6 pt-4 eoc-header">
      {/* Utility row */}
      <div className="flex items-center gap-3 eoc-utility">
        <div className={`${queue ? "flex-1 lg:hidden" : "flex-1"} eoc-search`} style={{ maxWidth: 420 }}>
          <SearchBar
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search name, address or phone"
            aria-label="Search incidents"
          />
        </div>
        <div style={{ flex: 1 }} />
        <Notifications cases={cases} criticalCount={criticalCount} onOpenCase={onOpenCase} onShowCritical={onShowCritical} />
        <div className="flex items-center gap-2">
          <span
            className="flex items-center justify-center font-bold"
            style={{ width: 36, height: 36, borderRadius: 999, background: "#1a1a1f", border: "1px solid #26262c", color: "#f5f5f6", fontSize: 12 }}
          >
            ED
          </span>
          <span className="hidden sm:flex flex-col" style={{ lineHeight: 1.3 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: "#f5f5f6" }}>Command desk</span>
            <span style={{ fontSize: 11, color: "#9a9aa0" }}>
              {identity ? (
                <CopyIdentity identity={identity}>
                  <code>ID {identity.slice(0, 6)}…{identity.slice(-4)}</code>
                </CopyIdentity>
              ) : (
                "Connecting…"
              )}
            </span>
          </span>
        </div>
      </div>

      {/* Page header */}
      <div className="mt-3">
        <PageHeader
          title="Emergency operations"
          status={connected ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Connecting</Badge>}
          description={description}
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={onShowFleet}>All units</Button>
              <Button variant="primary" size="sm" onClick={onAssignNext} disabled={stats.open === 0}>
                Assign next case
              </Button>
            </>
          }
        />
      </div>

      {/* The queue's panel does this filtering, and one filter at a time keeps the board explainable. */}
      {!queue && <div className="mt-3">
        <Tabs
          variant="underline"
          activeId={activeTab}
          onChange={(id) => onTabChange(id as FeedTab)}
          items={[
            { id: "all", label: "All", count: tabCounts.all },
            { id: "critical", label: "Critical", count: tabCounts.critical },
            { id: "in_transit", label: "In transit", count: tabCounts.in_transit },
            { id: "door_check", label: "Door checks", count: tabCounts.door_check },
            { id: "cleared", label: "Cleared", count: tabCounts.cleared },
          ]}
        />
      </div>}

      {/* KPI section */}
      {overview && <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 mt-4 pb-4">
        <Card label="Triage by urgency" style={{ gridColumn: "span 3 / span 3", padding: 16 }}>
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <div style={{ fontSize: 12.5, color: "#c2c2c9" }}>Households needing transport, by urgency</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 38, fontWeight: 400, letterSpacing: "-0.03em", color: "var(--ds-text)", fontVariantNumeric: "tabular-nums" }}>
                  {stats.open}
                </span>
                <span style={{ fontSize: 13, color: "#9a9aa0" }}>
                  {coverage ? `${stats.pct}% of zone accounted · ${stats.overlooked} overlooked` : "Coverage not reported yet"}
                </span>
              </div>
            </div>
            <Badge tone={stats.critical > 0 ? "danger" : "success"} dot>
              {stats.critical > 0 ? `${stats.critical} critical` : "No critical open"}
            </Badge>
          </div>
          <div className="mt-3">
            <Lollipops
              counts={[
                { id: "critical", label: "Critical", value: stats.critical, color: "#f87171", pill: stats.critical === Math.max(stats.critical, stats.high, stats.doorcheck, stats.medium, stats.cleared) && stats.critical > 0 },
                { id: "high", label: "High", value: stats.high, color: "#e8b84b", pill: false },
                { id: "door", label: "Door check", value: stats.doorcheck, color: "#c4a6ff", pill: stats.doorcheck === Math.max(stats.critical, stats.high, stats.doorcheck, stats.medium, stats.cleared) && stats.doorcheck > 0 && stats.critical === 0 },
                { id: "medium", label: "Medium", value: stats.medium, color: "#8fb0ff", pill: false },
                { id: "cleared", label: "Cleared", value: stats.cleared, color: "#3dd68c", pill: false },
              ]}
            />
          </div>
        </Card>

        <Card label="Zone coverage" style={{ gridColumn: "span 2 / span 2", display: "flex", flexDirection: "column", height: "100%", padding: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, justifyContent: "space-evenly" }}>
            <Stat label="Accounted" value={coverage ? `${stats.pct}%` : "?"} sub={coverage ? `${stats.accounted} of ${stats.inZone}` : "Coverage not reported yet"} delta={!coverage ? "no data" : stats.overlooked > 0 ? `${stats.overlooked} over` : "calm"} deltaTone={!coverage ? "neutral" : stats.overlooked > 0 ? "danger" : "success"} />
            <Stat label="Door checks" value={String(stats.door)} sub="Field team visits" delta={stats.door > 0 ? "visit" : "none"} deltaTone={stats.door > 0 ? "warning" : "neutral"} />
            <Stat label="En route" value={String(stats.inTransit)} sub={`${vehicles.length} units · ${stats.offered} offered`} delta={stats.inTransit > 0 ? "moving" : "staged"} deltaTone={stats.inTransit > 0 ? "info" : "neutral"} />
          </div>
          {segments && coverage && (
            <div className="mt-2">
              <CoverageBar segments={segments} total={Number(coverage.inZone)} compact />
            </div>
          )}
        </Card>
      </div>}
    </div>
  );
};
