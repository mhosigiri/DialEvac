import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmergencyFeed } from "../src/components/EmergencyFeed";
import type { CaseRow } from "../src/lib/cases";

const row = (id: bigint, mobility: string, oxygen: boolean, summary: string) =>
  ({
    household: { id, name: `Home ${id}`, address: "1 Test St", phone: "alias", mobility, oxygen, people: 1, simulated: true },
    account: "door_check",
    urgency: "critical",
    summary,
    action: { kind: "none" },
  }) as unknown as CaseRow;

const cases = [
  row(1n, "bedbound", true, "hazard time in about 8 minutes"),
  row(2n, "wheelchair", false, "hazard time passed about 2 minutes ago"),
];

for (const layout of ["list", "board"] as const) {
  test(`${layout} queue cards keep life-critical needs and the hazard summary`, () => {
    const html = renderToStaticMarkup(
      <EmergencyFeed cases={cases} loading={false} actionsEnabled busyHouseholdId={undefined} activeTab="all" query="" onOpenCase={() => {}} onCommand={() => {}} layout={layout} />
    );
    for (const text of ["Oxygen dependent", "Stretcher required", "Wheelchair access", "hazard time in about 8 minutes", "hazard time passed about 2 minutes ago"]) {
      assert.ok(html.includes(text), `missing "${text}"`);
    }
    assert.ok(!html.includes("line-clamp"), "a clamp can cut off hazard timing");
    assert.equal(html.includes("Not reached yet options"), layout === "board");
  });
}
