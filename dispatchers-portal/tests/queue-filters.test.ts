import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseRow } from "../src/lib/cases";
import { casesCsv, queueFilters } from "../src/queue";

const NOW = 1_000_000_000;
const inMinutes = (minutes: number) => ({ toMillis: () => BigInt(NOW + minutes * 60_000) });

const row = (id: bigint, overrides: Record<string, unknown> = {}, household: Record<string, unknown> = {}) =>
  ({
    household: { id, name: `Home ${id}`, address: "1 Test St", phone: "+15555550100", people: 1, mobility: "walks", oxygen: false, simulated: true, ...household },
    account: "reaching",
    urgency: "medium",
    summary: "text",
    action: { kind: "none" },
    ...overrides,
  }) as unknown as CaseRow;

const hazards = new Map([[1n, "hurricane"], [2n, "flood"], [9n, "flood"]]);
const filters = queueFilters(hazards, NOW);
const ids = (id: string, rows: CaseRow[]) => rows.filter(filters.find((f) => f.id === id)!.matches).map((r) => r.household.id);

const cases = [
  row(1n, { urgency: "critical" }, { oxygen: true }),
  row(2n, { call: { phase: "live" } }, { mobility: "wheelchair", hazardAt: inMinutes(10) }),
  row(3n, { action: { kind: "no_capable_unit", requestId: 1n } }, { mobility: "bedbound", hazardAt: inMinutes(-5) }),
  row(4n, { request: { mobility: "wheelchair", oxygen: false, people: 1 } }, { hazardAt: inMinutes(45) }),
  row(9n, { account: "helped", urgency: "critical", call: { phase: "ringing" } }, { oxygen: true, hazardAt: inMinutes(1) }),
];

test("every home stays reachable from All cases, including cleared ones", () => {
  assert.deepEqual(ids("all", cases), [1n, 2n, 3n, 4n, 9n]);
  assert.deepEqual(ids("cleared", cases), [9n]);
});

test("views only count cases that still need something", () => {
  assert.deepEqual(ids("critical", cases), [1n]);
  assert.deepEqual(ids("on_call", cases), [2n]);
  assert.deepEqual(ids("no_unit", cases), [3n]);
});

test("special transport reads the same answer the card shows, the request before the household", () => {
  assert.deepEqual(ids("special_transport", cases), [1n, 2n, 3n, 4n]);
});

test("a hazard already passed still counts as soon, and one beyond 30 minutes does not", () => {
  assert.deepEqual(ids("hazard_soon", cases), [2n, 3n]);
});

test("hazards come from catastrophe cases and keep their cleared homes", () => {
  assert.deepEqual(filters.filter((f) => f.group === "hazards").map((f) => f.label), ["Flood", "Hurricane"]);
  assert.deepEqual(ids("hazard:flood", cases), [2n, 9n]);
  assert.deepEqual(queueFilters(new Map(), NOW).filter((f) => f.group === "hazards"), []);
});

test("exported cells quote text and cannot run as spreadsheet formulas", () => {
  const csv = casesCsv([row(1n, {}, { name: '=HYPERLINK("http://x")', address: 'Apt "B", 2nd' })], hazards);
  const [header, line] = csv.split("\r\n");
  assert.ok(header.startsWith('"Name","Address","Phone"'));
  assert.ok(line.startsWith(`"'=HYPERLINK(""http://x"")","Apt ""B"", 2nd","'+15555550100"`), line);
  assert.ok(line.includes('"hurricane"'));
});
