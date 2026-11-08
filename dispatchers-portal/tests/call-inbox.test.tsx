import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Timestamp } from "spacetimedb";
import { CallInbox, ClaudeReview } from "../src/components/CallInbox";
import type { CallAnalysis, CallRecord } from "../src/module_bindings/types";

const record = { providerId: "conv_saved", agentId: "agent-test", direction: "inbound", status: "done", callerLabel: "Caller ending 5303", turns: [{ speaker: "resident", text: "I use a wheelchair." }], revision: 1n,
  recordedAt: new Timestamp(1_000_000n), updatedAt: new Timestamp(1_000_000n) } as CallRecord;
const result = { summary: "The caller reports a wheelchair need.", priority: "high", priorityReason: "Mobility assistance reported.", facts: [{ fact: "Wheelchair use", turn: 0, quote: "I use a wheelchair." }], unknowns: ["Pickup address"], recommendedActions: ["Confirm the pickup address"] };

test("call inbox keeps unlinked callers visible with original transcript and cited Claude analysis", () => {
  const analysis = { providerId: record.providerId, revision: 1n, state: "ready", resultJson: JSON.stringify(result), model: "claude-test" } as CallAnalysis;
  const html = renderToStaticMarkup(<CallInbox records={[record]} analyses={[analysis]} households={[]} onOpenCase={() => {}} onRetry={() => {}} disabled={false} />);
  for (const text of ["Caller needs identification", "Original transcript", "I use a wheelchair.", "Claude analysis", "Pickup address", "turn 1", "claude-test"]) assert.ok(html.includes(text),text);
});

test("analysis failure exposes a retry; a mismatched revision never displays stale analysis", () => {
  const failed = { providerId: record.providerId, revision: 1n, state: "failed", error: "Claude unavailable" } as CallAnalysis;
  const html = renderToStaticMarkup(<ClaudeReview record={record} analysis={failed} onRetry={() => {}} />);
  assert.ok(html.includes("Retry Claude analysis"));
  const stale = renderToStaticMarkup(<ClaudeReview record={record} analysis={{ ...failed, state: "ready", revision: 0n, resultJson: JSON.stringify(result) }} />);
  assert.ok(!stale.includes(result.summary));
});
