import { test } from "node:test";
import assert from "node:assert/strict";
import { CATASTROPHES, classifyCatastrophe, TRIAGE } from "../../shared/catastrophe-triage";
import { callClassification, callPhase, createCalls, durationOf, sessionFrom, visibleTurns } from "../src/outreach/simulation";
import { guardResidentTurn } from "../../spacetimedb/src/domain/honesty";

test("concurrent calls classify from complete resident observations and ask category-specific questions", () => {
  for (const category of CATASTROPHES) {
    const calls = createCalls(category, 144);
    const call = calls[0];
    assert.equal(callClassification(call, call.turns[1].end - 1).kind, "unknown");
    const classification = callClassification(call, call.turns[1].end);
    assert.equal(classification.kind, "classified");
    if (classification.kind === "classified") assert.equal(classification.category, category);
    assert.ok(call.turns.some(turn => turn.text === TRIAGE[category].questions[0]));
    assert.ok(calls.filter(call => callPhase(call, 15000) === "live").length > 18);
    assert.equal(calls.length, 144);
    for (const question of TRIAGE[category].questions) assert.equal(guardResidentTurn(question).blocked, false);
  }
});

test("silence becomes a door check and never a completed assessment", () => {
  const call = createCalls("flood", 72)[12];
  assert.equal(callPhase(call, call.startsAt - 1), "queued");
  assert.equal(callPhase(call, call.startsAt + 1), "ringing");
  assert.equal(callPhase(call, call.startsAt + 9000), "door_check");
  assert.deepEqual(visibleTurns(call, 300000), []);
  assert.equal(callClassification(call, 300000).kind, "unknown");
});

test("streaming turns expose partial text; handoffs include dispatcher speech before resolving", () => {
  const calls = createCalls("hurricane", 288);
  const call = calls[0];
  const turn = call.turns[0];
  const partial = visibleTurns(call, (turn.start + turn.end) / 2)[0];
  assert.equal(partial.final, false);
  assert.ok(partial.text.length > 0 && partial.text.length < turn.text.length);
  const dispatcher = call.turns.find(turn => turn.speaker === "dispatcher");
  assert.ok(dispatcher);
  assert.equal(callPhase(call, dispatcher.start), "live");
  assert.equal(callPhase(call, durationOf(calls)), "handoff");
  assert.ok(calls.every(call => !["queued", "live", "ringing"].includes(callPhase(call, durationOf(calls)))));
});

test("unknown, negated, hypothetical and multiple hazards cannot silently select a category", () => {
  for (const text of ["I need help", "There is no wildfire", "What if there is a tornado?", "Maybe the hurricane is approaching"]) assert.equal(classifyCatastrophe(text).kind, "unknown", text);
  assert.equal(classifyCatastrophe("A hurricane hit. Floodwater is inside.").kind, "ambiguous");
});

test("restored sessions validate types, bounds, and supported options", () => {
  const valid = { version: 1, category: "flood", size: 144, elapsed: 12345, speed: 2, selected: 12 };
  assert.deepEqual(sessionFrom(valid), valid);
  for (const patch of [{ elapsed: NaN }, { elapsed: Infinity }, { elapsed: -1 }, { selected: 144 }, { selected: -1 }, { size: 100000 }, { category: "alien" }, { speed: 3 }, { version: 2 }]) assert.equal(sessionFrom({ ...valid, ...patch }), undefined);
});
