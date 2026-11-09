import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedResidentPhrases, guardResidentTurn, SPEECH } from "../../spacetimedb/src/domain/honesty";
import { SURVEY_ASK, KEYPAD_ASK, SURVEY_INTRO } from "../../spacetimedb/src/domain/script";
import { guardedCompletion, type GuardChat } from "../src/voice-guard";
import type { Contract } from "../src/contract";

test("numbered message surveys cannot be spoken, including during an active warning", () => {
  const warning = { ride: null, assessmentRecorded: false, warningActive: true };
  for (const phrase of [SURVEY_ASK, KEYPAD_ASK, `${SURVEY_INTRO} ${SURVEY_ASK}`]) {
    assert.equal(approvedResidentPhrases(warning, "voice").includes(phrase), false);
    assert.equal(guardResidentTurn(phrase, warning, "voice").blocked, true);
  }
  assert.equal(guardResidentTurn(SURVEY_ASK, warning, "message").blocked, false);
  assert.equal(guardResidentTurn(`${SURVEY_INTRO} ${SURVEY_ASK}`, warning, "message").blocked, false);
});

test("the voice endpoint blocks the exact numbered fallback observed after a spoken no", async () => {
  const body: GuardChat = { messages: [{ role: "assistant", content: SPEECH.first }, { role: "user", content: "No." }] };
  const result = await guardedCompletion({} as Contract, body, "secret", async (_body, phrases) => {
    assert.ok(!phrases.includes(SURVEY_ASK));
    return { content: SURVEY_ASK };
  });
  assert.equal(result.blocked, true);
  assert.ok(!/\b(?:press|reply)\s+[1-4]/i.test(result.content ?? ""));
});

test("grounded saved details can be acknowledged with one question, while stale facts and extra claims are blocked", () => {
  const state = { ride: null, assessmentRecorded: true, requestStatus: "received" as const, assessment: { choice: "3" as const, people: 3, oxygen: true } };
  const summary = "Your answers are recorded: you need wheelchair-accessible transport for 3 people, with oxygen needed.";
  assert.equal(guardResidentTurn(`${summary} ${SPEECH.offerDispatcher}`, state).blocked, false);
  assert.equal(guardResidentTurn(`${summary} Help is on the way.`, state).blocked, true);
  assert.equal(guardResidentTurn(`${SPEECH.people} ${SPEECH.oxygen}`, state).blocked, true);
  assert.equal(guardResidentTurn(summary, { ...state, assessment: { ...state.assessment, people: 4 } }).blocked, true);
  assert.equal(guardResidentTurn(summary, { ...state, assessmentRecorded: false }).blocked, true);
});

test("provider tool history is represented as readable transcript data without replaying missing Gemini thought signatures", async () => {
  const { voiceModelMessages } = await import("../src/voice-history");
  const messages = voiceModelMessages({ messages: [
    { role: "assistant", content: SPEECH.first },
    { role: "user", content: "My mother uses a wheelchair and oxygen; there are three of us." },
    { role: "assistant", content: SPEECH.checking, tool_calls: [{ id: "call_without_signature", type: "function", function: { name: "record_assessment", arguments: '{"choice":"3","people":3,"oxygen":true}' } }] },
    { role: "tool", tool_call_id: "call_without_signature", name: "record_assessment", content: '{"recorded":true}' },
    { role: "user", content: "Actually four people, not three." },
  ] });
  assert.deepEqual(messages.map(message => message.role), ["system", "user"]);
  assert.ok(messages[1].content.includes("Actually four people, not three."));
  assert.ok(messages[1].content.includes("record_assessment"));
  assert.ok(!messages[1].content.includes("thought_signature"));
  assert.ok(!messages[1].content.includes("tool_call_id"));
});
