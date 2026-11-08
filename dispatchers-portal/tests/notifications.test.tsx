import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { criticalNotifications, Notifications } from "../src/components/Notifications";
import type { CaseRow } from "../src/lib/cases";

const row = (id: bigint, urgency: CaseRow["urgency"], account: CaseRow["account"]) =>
  ({
    household: { id, name: `Home ${id}`, address: "1 Test St", phone: "alias", mobility: "walks", oxygen: false, people: 1, simulated: true },
    account,
    urgency,
    summary: "hazard time in about 8 minutes",
    action: { kind: "none" },
  }) as unknown as CaseRow;

const cases = [
  row(1n, "critical", "help_requested"),
  row(2n, "high", "help_requested"),
  row(3n, "critical", "helped"),
];

test("notifications include open critical cases and exclude cleared or lower-urgency cases", () => {
  assert.deepEqual(criticalNotifications(cases).map((item) => item.household.id), [1n]);
});

test("the notification trigger exposes its state and critical count", () => {
  const html = renderToStaticMarkup(
    <Notifications cases={cases} criticalCount={1} onOpenCase={() => {}} onShowCritical={() => {}} />,
  );
  assert.ok(html.includes('aria-label="Notifications (1 critical)"'));
  assert.ok(html.includes('aria-haspopup="dialog"'));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('aria-controls='));
});
