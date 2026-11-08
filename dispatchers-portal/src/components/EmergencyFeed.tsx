import React, { useMemo, useState } from "react";
import { HeartPulse, Accessibility, Navigation, Check, CircleAlert, PhoneCall } from "lucide-react";
import type { CaseRow } from "../lib/cases";
import type { Command } from "../commands";
import { hazardTime, isCleared, matchesQuery } from "../queue";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { Card, CardHeader } from "../design-system/Card";
import { CaseCard as DispatchCaseCard } from "../design-system/CaseCard";
import type { CaseSeverity } from "../design-system/CaseCard";
import { EmptyState } from "../design-system/EmptyState";
import { Menu } from "../design-system/Menu";
import { Skeleton } from "../design-system/Skeleton";

export type FeedTab = "all" | "critical" | "in_transit" | "door_check" | "cleared";

interface EmergencyFeedProps {
  cases: readonly CaseRow[];
  loading: boolean;
  actionsEnabled: boolean;
  busyHouseholdId?: bigint;
  activeTab: FeedTab;
  query: string;
  selectedHouseholdId?: bigint;
  onOpenCase: (householdId: bigint) => void;
  onCommand: (householdId: bigint, command: Command) => void;
  layout?: "list" | "board";
  onExportCases?: (rows: readonly CaseRow[], name: string) => void;
}

export const ACCOUNT: Record<CaseRow["account"], { label: string; tone: "danger" | "warning" | "info" | "success" | "neutral" }> = {
  overlooked: { label: "Overlooked", tone: "danger" },
  escalated: { label: "Escalated", tone: "danger" },
  door_check: { label: "Door check needed", tone: "warning" },
  help_requested: { label: "Help requested", tone: "info" },
  reaching: { label: "Reaching", tone: "neutral" },
  helped: { label: "Helped", tone: "success" },
  leaving_on_own: { label: "Leaving on own", tone: "success" },
};

const PAGE = 100;
const BOARD_COLUMN_LIMIT = 6;

// Named for what each case needs next. Accounts cover every home, so nothing can read as needing nothing.
const BOARD_COLUMNS = [
  { id: "unreached", label: "Not reached yet" },
  { id: "door_check", label: "Door check needed" },
  { id: "waiting", label: "Waiting for a unit" },
  { id: "underway", label: "On the way" },
  { id: "cleared", label: "Cleared" },
] as const;

function columnFor(row: CaseRow): (typeof BOARD_COLUMNS)[number]["id"] {
  switch (row.account) {
    case "overlooked":
    case "reaching":
      return "unreached";
    case "door_check":
      return "door_check";
    case "help_requested":
    case "escalated":
      return row.action.kind === "close" || row.assignment?.status === "accepted" ? "underway" : "waiting";
    case "helped":
    case "leaving_on_own":
      return "cleared";
  }
}

// Cases arrive highest urgency first, so that sort keeps their order.
const COLUMN_SORTS = {
  urgency: { label: "Highest urgency first", compare: () => 0 },
  hazard: { label: "Soonest hazard first", compare: (a: CaseRow, b: CaseRow) => hazardTime(a) - hazardTime(b) },
  name: { label: "Name A to Z", compare: (a: CaseRow, b: CaseRow) => a.household.name.localeCompare(b.household.name) },
};
type ColumnSort = keyof typeof COLUMN_SORTS;
const SORT_IDS = Object.keys(COLUMN_SORTS) as ColumnSort[];

const TAB_FILTER: Record<FeedTab, (row: CaseRow) => boolean> = {
  all: () => true,
  critical: (row) => row.urgency === "critical" && !isCleared(row),
  in_transit: (row) => row.assignment?.status === "accepted",
  door_check: (row) => row.account === "door_check",
  cleared: isCleared,
};

const TABS: { id: FeedTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "in_transit", label: "In transit" },
  { id: "door_check", label: "Door checks" },
  { id: "cleared", label: "Cleared" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const words = (value: string) => value.replace(/_/g, " ");

const OPEN_CALL_LABEL: Record<string, string> = { queued: "Call queued", ringing: "Call ringing", live: "On call now" };

function PrimaryAction({ row, disabled, send }: { row: CaseRow; disabled: boolean; send: (command: Command) => void }) {
  const { action, match } = row;
  if (action.kind === "dispatch" && match)
    return (
      <Button variant="primary" size="sm" fullWidth disabled={disabled} onClick={() => send(action)}>
        Dispatch {match.vehicle.name}
      </Button>
    );
  if (action.kind === "approve")
    return (
      <Button variant="primary" size="sm" fullWidth disabled={disabled} onClick={() => send(action)}>
        Send offer to driver
      </Button>
    );
  if (action.kind === "close")
    return (
      <Button variant="success" size="sm" fullWidth disabled={disabled} onClick={() => send(action)}>
        Mark rescued
      </Button>
    );
  return null;
}

function DriverAnswer({ assignmentId, disabled, send }: { assignmentId: bigint; disabled: boolean; send: (command: Command) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span style={{ fontSize: 12, color: "#9a9aa0" }}>Driver's answer</span>
      <div className="flex items-center gap-2">
        <Button variant="success" size="sm" disabled={disabled} leadingIcon={<Check className="w-3.5 h-3.5" />} onClick={() => send({ kind: "accept", assignmentId })}>
          Driver accepted
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => send({ kind: "decline", assignmentId })}>
          Driver declined
        </Button>
      </div>
    </div>
  );
}

/** Whatever this case is waiting on, for surfaces with room to show it in one place. */
export function CaseActions({
  row,
  disabled,
  send,
  fallback,
}: {
  row: CaseRow;
  disabled: boolean;
  send: (command: Command) => void;
  fallback: React.ReactNode;
}) {
  const { action } = row;
  if (action.kind === "driver_response") return <DriverAnswer assignmentId={action.assignmentId} disabled={disabled} send={send} />;
  if (action.kind === "dispatch" || action.kind === "approve" || action.kind === "close") return <PrimaryAction row={row} disabled={disabled} send={send} />;
  return <>{fallback}</>;
}

function CaseCard({
  row,
  selected,
  disabled,
  onOpenCase,
  onCommand,
}: {
  row: CaseRow;
  selected: boolean;
  disabled: boolean;
  onOpenCase: EmergencyFeedProps["onOpenCase"];
  onCommand: EmergencyFeedProps["onCommand"];
}) {
  const { household, request, assignment, call, urgency, match, action, account } = row;
  const oxygen = request?.oxygen ?? household.oxygen;
  const mobility = request?.mobility ?? household.mobility;
  const people = request?.people ?? household.people;
  const send = (command: Command) => onCommand(household.id, command);
  const cleared = isCleared(row);
  const callLabel = call && OPEN_CALL_LABEL[call.phase];

  const peopleWords = `${people} ${people === 1 ? "occupant" : "occupants"}`;
  const subtitleLine = [household.address, household.phone, peopleWords].join(" · ");

  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  const driverRow =
    assignment && match ? (
      <span className="flex items-center gap-2" style={{ fontSize: 12.5, minWidth: 0, width: "100%" }}>
        <span
          aria-hidden
          className="flex items-center justify-center shrink-0"
          style={{ width: 28, height: 28, borderRadius: 8, background: "#232329", color: "#f5f5f6", fontSize: 11, fontWeight: 700 }}
        >
          {initials(match.vehicle.driverName)}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#f5f5f6" }}>
          {match.vehicle.driverName}
        </span>
        <span style={{ marginLeft: "auto", color: "#9a9aa0", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {assignment.etaMinutes} min ETA
        </span>
      </span>
    ) : undefined;

  // Two answers don't fit beside the name on the card's first line, and the name is what they're for.
  const driverResponse =
    action.kind === "driver_response" ? <DriverAnswer assignmentId={action.assignmentId} disabled={disabled} send={send} /> : undefined;

  const matchPanel =
    action.kind === "dispatch" && match ? (
      <div
        className="p-2.5 flex items-center gap-2"
        style={{
          fontSize: 12,
          borderRadius: "12px",
          background: "rgb(143 176 255 / 14%)",
          border: "1px solid transparent",
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        <Navigation className="w-4 h-4 shrink-0" style={{ color: "#8fb0ff" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "#f5f5f6" }}>
            Closest capable unit: {match.vehicle.name}{" "}
            <span style={{ fontWeight: 400, fontSize: 11, color: "#9a9aa0" }}>({match.vehicle.driverName})</span>
          </div>
          <div style={{ fontSize: 11, color: "#9a9aa0" }}>
            {match.distanceMiles} miles away • ~{match.etaMinutes} min response
          </div>
        </div>
      </div>
    ) : action.kind === "no_capable_unit" ? (
      <div
        className="p-2.5 flex items-center gap-2"
        style={{
          fontSize: 12,
          fontWeight: 600,
          borderRadius: "12px",
          background: "rgb(248 113 113 / 14%)",
          border: "1px solid rgb(248 113 113 / 35%)",
          color: "#f5f5f6",
        }}
      >
        <CircleAlert className="w-4 h-4 shrink-0" style={{ color: "#f87171" }} />
        No unit in the fleet can carry this household.
      </div>
    ) : undefined;

  return (
    <DispatchCaseCard
      severity={(account === "door_check" && !cleared && (urgency === "medium" || urgency === "low") ? "doorcheck" : urgency) as CaseSeverity}
      resolved={cleared}
      selected={selected}
      onSelect={() => onOpenCase(household.id)}
      title={household.name}
      subtitle={subtitleLine}
      meta={driverRow}
      badges={
        <>
          <Badge tone={ACCOUNT[account].tone}>{ACCOUNT[account].label}</Badge>
          {callLabel && (
            <Badge tone={call?.phase === "live" ? "danger" : "warning"} dot>
              <PhoneCall className="w-3 h-3" />
              {callLabel}
            </Badge>
          )}
          {/* Dispatchers scan for these. They stay badges even where a reference card shows fewer pills. */}
          {oxygen && (
            <Badge tone="danger" dot>
              <HeartPulse className="w-3 h-3" />
              Oxygen dependent
            </Badge>
          )}
          {mobility === "bedbound" && <Badge tone="danger">Stretcher required</Badge>}
          {mobility === "wheelchair" && (
            <Badge tone="warning">
              <Accessibility className="w-3 h-3" />
              Wheelchair access
            </Badge>
          )}
          {request && account !== "helped" && (
            <Badge tone="neutral">
              Ride: <span className="capitalize">{words(request.status)}</span>
            </Badge>
          )}
          {household.simulated && <Badge tone="neutral">Simulated</Badge>}
        </>
      }
      summary={row.summary}
      actions={<PrimaryAction row={row} disabled={disabled} send={send} />}
      footer={
        matchPanel || driverResponse ? (
          <div
            className="pt-2"
            style={{ borderTop: "1px solid #26262c" }}
          >
            {matchPanel ?? driverResponse}
          </div>
        ) : undefined
      }
    />
  );
}

export const EmergencyFeed: React.FC<EmergencyFeedProps> = ({
  cases,
  loading,
  actionsEnabled,
  busyHouseholdId,
  activeTab,
  query,
  selectedHouseholdId,
  onOpenCase,
  onCommand,
  layout = "list",
  onExportCases,
}) => {
  const [limit, setLimit] = useState(PAGE);
  const [openColumns, setOpenColumns] = useState<ReadonlySet<string>>(new Set());
  const [columnSorts, setColumnSorts] = useState<Readonly<Record<string, ColumnSort>>>({});
  const q = query.trim().toLowerCase();

  const searched = useMemo(() => cases.filter((row) => matchesQuery(row, q)), [cases, q]);
  const filtered = useMemo(() => searched.filter(TAB_FILTER[activeTab]), [searched, activeTab]);

  const columns = useMemo(
    () =>
      BOARD_COLUMNS.map((column) => ({
        ...column,
        rows: filtered.filter((row) => columnFor(row) === column.id).sort(COLUMN_SORTS[columnSorts[column.id] ?? "urgency"].compare),
      })),
    [filtered, columnSorts]
  );

  const renderRow = (row: CaseRow) => (
    <CaseCard
      key={String(row.household.id)}
      row={row}
      disabled={!actionsEnabled || busyHouseholdId === row.household.id}
      selected={selectedHouseholdId === row.household.id}
      onOpenCase={onOpenCase}
      onCommand={onCommand}
    />
  );

  if (layout === "board") {
    return (
      <div
        role="list"
        aria-label="Evacuation queue by what each case is waiting on"
        className="eoc-board"
        style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(272px, 1fr)", gap: 16, overflowX: "auto", marginTop: 16, paddingBottom: 8 }}
      >
        {columns.map((g) => {
          const expanded = openColumns.has(g.id);
          const shown = expanded ? g.rows : g.rows.slice(0, BOARD_COLUMN_LIMIT);
          return (
            <section key={g.id} role="listitem" aria-label={g.label} className="eoc-board-column" style={{ background: "var(--ds-surface-inset)", border: "1px solid var(--ds-border)", borderRadius: "var(--ds-radius-panel)", padding: 14, minWidth: 0 }}>
              <header className="flex items-center gap-2" style={{ padding: "0 4px 12px", flexShrink: 0 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "#f5f5f6" }}>{g.label}</h2>
                <Badge tone="neutral">{g.rows.length}</Badge>
                <span style={{ marginLeft: "auto" }}>
                  <Menu
                    label={`${g.label} options`}
                    items={[
                      ...SORT_IDS.map((id) => ({
                        label: COLUMN_SORTS[id].label,
                        checked: (columnSorts[g.id] ?? "urgency") === id,
                        onSelect: () => setColumnSorts({ ...columnSorts, [g.id]: id }),
                      })),
                      { label: "Open top case", separatorBefore: true, disabled: g.rows.length === 0, onSelect: () => onOpenCase(g.rows[0].household.id) },
                      {
                        label: expanded ? "Show fewer" : `Show all ${g.rows.length}`,
                        disabled: g.rows.length <= BOARD_COLUMN_LIMIT,
                        onSelect: () => {
                          const next = new Set(openColumns);
                          if (expanded) next.delete(g.id);
                          else next.add(g.id);
                          setOpenColumns(next);
                        },
                      },
                      { label: "Export this column", disabled: g.rows.length === 0, onSelect: () => onExportCases?.(g.rows, g.label) },
                    ]}
                  />
                </span>
              </header>
              <div className="eoc-board-column-body" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 2 }}>
                {loading ? <Skeleton lines={3} /> : shown.length === 0 ? (
                  <div style={{ padding: "24px 12px", textAlign: "center", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#c2c2c9" }}>No cases here</div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ds-text-muted)", marginTop: 5 }}>Cases land here when they match this stage.</div>
                  </div>
                ) : shown.map(renderRow)}
                {g.rows.length > BOARD_COLUMN_LIMIT && !expanded && (
                  <Button variant="secondary" size="sm" fullWidth onClick={() => setOpenColumns(new Set(openColumns).add(g.id))}>
                    {g.rows.length - BOARD_COLUMN_LIMIT} more
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <Card label="Evacuation queue" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <CardHeader
        title="Evacuation queue"
        subtitle={q ? `${filtered.length} of ${cases.length} match “${query.trim()}”` : "Highest urgency first · one action per case"}
        action={
          <span style={{ fontSize: 12, color: "#9a9aa0", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {plural(filtered.length, "case")}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0, paddingTop: 4, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          <div className="py-6">
            <Skeleton lines={4} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={q ? `No cases match “${query.trim()}”.` : "No cases in this view."}
            detail="Try a different search or pick another tab."
          />
        ) : (
          <>
            {filtered.slice(0, limit).map(renderRow)}
            {filtered.length > limit && (
              <Button variant="secondary" size="sm" fullWidth onClick={() => setLimit(limit + PAGE)}>
                Show {Math.min(PAGE, filtered.length - limit)} more of {filtered.length - limit} remaining
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
};
