import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCaseToAssign } from "../src/queue";
import type { CaseRow } from "../src/lib/cases";

const row = (name: string, urgency: CaseRow["urgency"], kind: CaseRow["action"]["kind"], account = "help_requested") =>
  ({ household: { name }, urgency, account, action: { kind } }) as unknown as CaseRow;

test("a critical case with a driver does not block an unassigned critical case", () => {
  const cases = [row("accepted", "critical", "close"), row("waiting", "critical", "dispatch")];
  assert.equal(nextCaseToAssign(cases)?.household.name, "waiting");
});

test("an unassigned high case comes before a critical case that already has a driver", () => {
  const cases = [row("accepted", "critical", "close"), row("waiting", "high", "dispatch")];
  assert.equal(nextCaseToAssign(cases)?.household.name, "waiting");
});

test("a critical unassigned case comes before a less urgent one", () => {
  const cases = [row("high", "high", "dispatch"), row("critical", "critical", "approve")];
  assert.equal(nextCaseToAssign(cases)?.household.name, "critical");
});

test("with nothing to assign, the next open case still opens", () => {
  const cases = [row("cleared", "low", "close", "helped"), row("accepted", "high", "close")];
  assert.equal(nextCaseToAssign(cases)?.household.name, "accepted");
});

test("no open cases gives no case", () => {
  assert.equal(nextCaseToAssign([row("none", "low", "none")]), undefined);
});
