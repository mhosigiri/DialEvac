import React, { useState } from "react";
import { ChevronDown, CircleCheck, Download, Flame, Inbox, SlidersHorizontal } from "lucide-react";
import type { CaseRow } from "../lib/cases";
import type { QueueFilter, QueueScope } from "../queue";
import { SearchBar } from "../design-system/SearchBar";

const MINE_NOTE = "Cases you acted on from this browser.";

const SCOPES: { id: QueueScope; label: string }[] = [
  { id: "team", label: "Team" },
  { id: "mine", label: "Mine" },
];

interface QueueControls {
  filters: readonly QueueFilter[];
  cases: readonly CaseRow[];
  scope: QueueScope;
  onScopeChange: (scope: QueueScope) => void;
  filterId: string;
  onFilterChange: (id: string) => void;
}

const countOf = (filter: QueueFilter, cases: readonly CaseRow[]) => cases.filter(filter.matches).length;

const Count: React.FC<{ value: number; alert?: boolean }> = ({ value, alert }) => (
  <span
    style={{
      minWidth: 24,
      height: 22,
      padding: "0 7px",
      borderRadius: 999,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      fontVariantNumeric: "tabular-nums",
      background: alert && value > 0 ? "rgb(248 113 113 / 18%)" : "#232329",
      color: alert && value > 0 ? "#f87171" : "#c2c2c9",
    }}
  >
    {value}
  </span>
);

const ScopeToggle: React.FC<Pick<QueueControls, "scope" | "onScopeChange">> = ({ scope, onScopeChange }) => (
  <div role="group" aria-label="Whose cases" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 14, background: "#1a1a1f" }}>
    {SCOPES.map(({ id, label }) => (
      <button
        key={id}
        type="button"
        aria-pressed={scope === id}
        onClick={() => onScopeChange(id)}
        style={{ height: 32, border: "none", borderRadius: 10, fontSize: 13, cursor: "pointer", background: scope === id ? "#2c2c33" : "transparent", color: scope === id ? "#f5f5f6" : "#9a9aa0", fontWeight: scope === id ? 500 : 400 }}
      >
        {label}
      </button>
    ))}
  </div>
);

const Row: React.FC<{ filter: QueueFilter; count: number; active: boolean; icon?: React.ReactNode; onSelect: () => void }> = ({ filter, count, active, icon, onSelect }) => (
  <button
    type="button"
    aria-current={active ? "true" : undefined}
    onClick={onSelect}
    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 38, padding: "0 10px", border: "none", borderRadius: 12, fontSize: 13, textAlign: "left", cursor: "pointer", background: active ? "#232329" : "transparent", color: active ? "#f5f5f6" : "#c2c2c9", fontWeight: active ? 500 : 400 }}
  >
    {icon}
    <span style={{ flex: 1, minWidth: 0 }}>{filter.label}</span>
    <Count value={count} alert={filter.alert} />
  </button>
);

const Group: React.FC<{ title: string; icon: React.ReactNode; filters: readonly QueueFilter[]; controls: QueueControls }> = ({ title, icon, filters, controls }) => {
  const [expanded, setExpanded] = useState(true);
  if (filters.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", height: 36, padding: "0 10px", border: "none", background: "transparent", fontSize: 13, color: "#9a9aa0", cursor: "pointer" }}
      >
        {icon}
        <span style={{ flex: 1, textAlign: "left" }}>{title}</span>
        <ChevronDown className="w-4 h-4" style={{ transform: expanded ? undefined : "rotate(-90deg)" }} />
      </button>
      {expanded && (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 0 0 18px" }}>
          {filters.map((filter, index) => (
            <li key={filter.id} style={{ position: "relative", paddingLeft: 16 }}>
              {index < filters.length - 1 && <span aria-hidden style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderLeft: "1px solid #33333a" }} />}
              <span aria-hidden style={{ position: "absolute", left: 0, top: 0, height: "50%", width: 12, borderLeft: "1px solid #33333a", borderBottom: "1px solid #33333a", borderBottomLeftRadius: 8 }} />
              <Row filter={filter} count={countOf(filter, controls.cases)} active={controls.filterId === filter.id} onSelect={() => controls.onFilterChange(filter.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** Reference queue sidebar. It holds one filter at a time, so a selected row always explains what the board shows. */
export const QueuePanel: React.FC<QueueControls & { query: string; onQueryChange: (query: string) => void; onExport: () => void }> = ({ query, onQueryChange, onExport, ...controls }) => {
  const { filters, cases, filterId, onFilterChange, scope, onScopeChange } = controls;
  const single = (group: QueueFilter["group"], icon: React.ReactNode) =>
    filters
      .filter((f) => f.group === group)
      .map((f) => <Row key={f.id} filter={f} count={countOf(f, cases)} active={filterId === f.id} icon={icon} onSelect={() => onFilterChange(f.id)} />);

  return (
    <aside
      aria-label="Queue filters"
      className="hidden lg:flex flex-col shrink-0"
      style={{ width: 264, margin: "12px 0", padding: 14, gap: 12, background: "#0c0c0e", border: "1px solid #26262c", borderRadius: 20, overflowY: "auto" }}
    >
      <h2 style={{ margin: "4px 4px 0", fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em", color: "#f5f5f6" }}>Queue</h2>
      <ScopeToggle scope={scope} onScopeChange={onScopeChange} />
      {scope === "mine" && <p style={{ margin: "-4px 4px 0", fontSize: 11.5, lineHeight: 1.4, color: "#9a9aa0" }}>{MINE_NOTE}</p>}
      <SearchBar value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Search cases" aria-label="Search cases" />
      <div className="flex flex-col" style={{ gap: 6 }}>
        {single("top", <Inbox className="w-4 h-4" />)}
        <Group title="Views" icon={<SlidersHorizontal className="w-4 h-4" />} filters={filters.filter((f) => f.group === "views")} controls={controls} />
        <Group title="Hazards" icon={<Flame className="w-4 h-4" />} filters={filters.filter((f) => f.group === "hazards")} controls={controls} />
      </div>
      <div className="flex flex-col" style={{ marginTop: "auto", gap: 2 }}>
        {single("bottom", <CircleCheck className="w-4 h-4" />)}
        <button
          type="button"
          onClick={onExport}
          style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 38, padding: "0 10px", border: "none", borderRadius: 12, background: "transparent", fontSize: 13, color: "#c2c2c9", cursor: "pointer" }}
        >
          <Download className="w-4 h-4" />
          Export shown cases
        </button>
      </div>
    </aside>
  );
};

/** The same filters where the panel doesn't fit beside the board. */
export const QueueFilterBar: React.FC<QueueControls> = ({ filters, cases, scope, onScopeChange, filterId, onFilterChange }) => (
  <div className="lg:hidden flex flex-col" style={{ gap: 8, marginTop: 12 }}>
    <ScopeToggle scope={scope} onScopeChange={onScopeChange} />
    {scope === "mine" && <p style={{ margin: 0, fontSize: 11.5, color: "#9a9aa0" }}>{MINE_NOTE}</p>}
    <select
      aria-label="Queue filter"
      value={filterId}
      onChange={(e) => onFilterChange(e.target.value)}
      style={{ height: 40, padding: "0 10px", borderRadius: 12, background: "#1a1a1f", border: "1px solid #26262c", color: "#f5f5f6", fontSize: 13 }}
    >
      {filters.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label} ({countOf(f, cases)})
        </option>
      ))}
    </select>
  </div>
);
