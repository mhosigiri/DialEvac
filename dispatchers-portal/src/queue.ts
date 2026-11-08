import type { CaseRow } from "./lib/cases";

export type QueueScope = "team" | "mine";

export type QueueFilter = {
  id: string;
  label: string;
  group: "top" | "views" | "hazards" | "bottom";
  alert?: boolean;
  matches: (row: CaseRow) => boolean;
};

const HAZARD_SOON_MS = 30 * 60_000;
const MINE_KEY = "dispatch:my-cases";
const SPREADSHEET_FORMULA = /^[=+\-@\t\r]/;

export const ALL_CASES = "all";
export const CRITICAL_CASES = "critical";

export function isCleared(row: CaseRow) {
  return row.account === "helped" || row.account === "leaving_on_own";
}

// Cases that already have a driver still carry an action, so they must not block unassigned ones.
export function nextCaseToAssign(cases: readonly CaseRow[]) {
  const open = cases.filter(c => !isCleared(c) && c.action.kind !== "none");
  const assignable = open.filter(c => c.action.kind === "dispatch" || c.action.kind === "approve");
  const pool = assignable.length ? assignable : open;
  return pool.find(c => c.urgency === "critical") ?? pool[0];
}

export function matchesQuery({ household: h }: CaseRow, query: string) {
  const q = query.trim().toLowerCase();
  return !q || `${h.name} ${h.address} ${h.phone}`.toLowerCase().includes(q);
}

export function hazardTime({ household, request }: CaseRow) {
  const at = household.hazardAt ?? request?.deadlineAt;
  return at ? Number(at.toMillis()) : Number.POSITIVE_INFINITY;
}

const needsSpecialTransport = ({ household, request }: CaseRow) => {
  const record = request ?? household;
  return record.oxygen || record.mobility === "bedbound" || record.mobility === "wheelchair";
};

const open = (rule: (row: CaseRow) => boolean) => (row: CaseRow) => !isCleared(row) && rule(row);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Rules run over real case fields. Hazards come from the data, so a database without them shows none. */
export function queueFilters(hazards: ReadonlyMap<bigint, string>, now: number): QueueFilter[] {
  return [
    { id: ALL_CASES, label: "All cases", group: "top", matches: () => true },
    { id: CRITICAL_CASES, label: "Critical", group: "views", alert: true, matches: open((r) => r.urgency === "critical") },
    { id: "special_transport", label: "Special transport", group: "views", matches: open(needsSpecialTransport) },
    { id: "hazard_soon", label: "Hazard within 30 min", group: "views", matches: open((r) => hazardTime(r) - now <= HAZARD_SOON_MS) },
    { id: "on_call", label: "On a call now", group: "views", matches: open((r) => r.call?.phase === "live" || r.call?.phase === "ringing") },
    { id: "no_unit", label: "No capable unit", group: "views", alert: true, matches: open((r) => r.action.kind === "no_capable_unit") },
    ...[...new Set(hazards.values())].sort().map(
      (hazard): QueueFilter => ({
        id: `hazard:${hazard}`,
        label: capitalize(hazard),
        group: "hazards",
        matches: (r) => hazards.get(r.household.id) === hazard,
      })
    ),
    { id: "cleared", label: "Cleared", group: "bottom", matches: isCleared },
  ];
}

export function loadMyCases(): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveMyCases(ids: ReadonlySet<string>) {
  localStorage.setItem(MINE_KEY, JSON.stringify([...ids]));
}

const CSV_COLUMNS: [string, (row: CaseRow, hazard?: string) => string | number | boolean][] = [
  ["Name", (r) => r.household.name],
  ["Address", (r) => r.household.address],
  ["Phone", (r) => r.household.phone],
  ["Urgency", (r) => r.urgency],
  ["Status", (r) => r.account.replace(/_/g, " ")],
  ["Hazard", (_, hazard) => hazard ?? ""],
  ["Occupants", (r) => (r.request ?? r.household).people],
  ["Mobility", (r) => (r.request ?? r.household).mobility],
  ["Oxygen", (r) => (r.request ?? r.household).oxygen],
  ["Summary", (r) => r.summary],
];

// Household text comes from outside the portal, so a cell must not run as a formula when the file is opened.
function csvCell(value: string | number | boolean) {
  const text = String(value);
  return `"${(SPREADSHEET_FORMULA.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}

export function casesCsv(rows: readonly CaseRow[], hazards: ReadonlyMap<bigint, string>) {
  const lines = [
    CSV_COLUMNS.map(([header]) => csvCell(header)),
    ...rows.map((row) => CSV_COLUMNS.map(([, read]) => csvCell(read(row, hazards.get(row.household.id))))),
  ];
  return lines.map((cells) => cells.join(",")).join("\r\n");
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `dispatch-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
