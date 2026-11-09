import { test } from "node:test";
import assert from "node:assert/strict";
import { guardResidentTurn, SPEECH, statusLine, type ResidentSpeechState } from "../../spacetimedb/src/domain/honesty";
import { decideTurn, parseUnderstanding, type Conversation, type TurnContext, type Understanding } from "../src/voice-intake";

const nothing: Understanding = { latest: "answer", canLeaveAlone: null, everyoneCanWalk: null, wheelchair: null, liftedOrCarried: null, people: null, oxygen: null, wantsDispatcher: null, hazardQuestionsAnswered: [] };
const start: Conversation = { agentLines: [SPEECH.first], toolRequests: [], lastWasSave: false, residentJustSpoke: true };
const allTools = new Set(["record_assessment", "request_handoff", "transfer_to_number", "end_call", "voicemail_detection"]);
const context = (state?: ResidentSpeechState, more: Partial<TurnContext> = {}): TurnContext => ({ kind: "survey", state, tools: allTools, transfers: ["+12142009999"], bound: true, ...more });
const saved = (choice: "1" | "2" | "3" | "4", people: number, oxygen: boolean): ResidentSpeechState => ({ ride: null, assessmentRecorded: true, canLeave: choice === "1", requestStatus: choice === "1" ? undefined : "received", assessment: { choice, people, oxygen } });
const toolNames = (turn: ReturnType<typeof decideTurn>) => (turn.tool_calls ?? []).map(tool => tool.function.name);
const afterSave = (args: Record<string, unknown>, lines: string[] = [SPEECH.first]): Conversation => ({ agentLines: lines, toolRequests: [{ name: "record_assessment", args }], lastWasSave: true, residentJustSpoke: false });

test("a bare no is not saved as a guess: it leads to the next relevant question", () => {
  const turn = decideTurn({ ...nothing, canLeaveAlone: false }, start, context());
  assert.equal(turn.content, SPEECH.walking);
  assert.deepEqual(toolNames(turn), []);
});

test("each answer moves to the next missing fact, and answered questions are skipped", () => {
  assert.equal(decideTurn({ ...nothing, canLeaveAlone: false, everyoneCanWalk: false }, start, context()).content, SPEECH.wheelchair);
  assert.equal(decideTurn({ ...nothing, canLeaveAlone: false, everyoneCanWalk: false, wheelchair: false }, start, context()).content, SPEECH.lifting);
  assert.equal(decideTurn({ ...nothing, canLeaveAlone: false, wheelchair: true }, start, context()).content, SPEECH.people);
  assert.equal(decideTurn({ ...nothing, canLeaveAlone: true, people: 2 }, start, context()).content, SPEECH.oxygen);
});

test("all four transport needs are saved once with what the resident told us", () => {
  const cases: [Partial<Understanding>, string][] = [[{ canLeaveAlone: true }, "1"], [{ canLeaveAlone: false, everyoneCanWalk: true }, "2"], [{ canLeaveAlone: false, wheelchair: true }, "3"], [{ canLeaveAlone: false, liftedOrCarried: true, wheelchair: true }, "4"]];
  for (const [facts, choice] of cases) {
    const turn = decideTurn({ ...nothing, ...facts, people: 3, oxygen: true }, start, context());
    assert.deepEqual(toolNames(turn), ["record_assessment"]);
    assert.deepEqual(JSON.parse(turn.tool_calls![0].function.arguments), { choice, people: 3, oxygen: true });
  }
});

test("a save is not repeated, and a correction saves again", () => {
  const facts = { ...nothing, canLeaveAlone: false, everyoneCanWalk: true, people: 2, oxygen: false };
  const once = afterSave({ choice: "2", people: 2, oxygen: false });
  assert.deepEqual(toolNames(decideTurn(facts, once, context(saved("2", 2, false)))), []);
  const corrected = decideTurn({ ...facts, people: 3 }, { ...once, lastWasSave: false, residentJustSpoke: true }, context(saved("2", 2, false)));
  assert.deepEqual(JSON.parse(corrected.tool_calls![0].function.arguments), { choice: "2", people: 3, oxygen: false });
});

test("a failed save is admitted and never reported as saved", () => {
  const facts = { ...nothing, canLeaveAlone: true, people: 1, oxygen: false };
  const turn = decideTurn(facts, afterSave({ choice: "1", people: 1, oxygen: false }), context({ ride: null, assessmentRecorded: false }));
  assert.equal(turn.content, SPEECH.persistenceUnknown);
  assert.deepEqual(toolNames(turn), ["end_call"]);
});

test("the database decides what is saved, even if the replayed history omits the tool call", () => {
  const facts = { ...nothing, canLeaveAlone: true, people: 1, oxygen: false };
  assert.deepEqual(toolNames(decideTurn(facts, start, context(saved("1", 1, false)))), []);
  const stale = decideTurn(facts, afterSave({ choice: "1", people: 1, oxygen: false }), context(saved("1", 2, false)));
  assert.equal(stale.content, SPEECH.persistenceUnknown);
});

test("after saving, it summarizes the verified record, asks hazard questions only for people needing help, then offers a dispatcher", () => {
  const state = saved("2", 2, false), facts = { ...nothing, canLeaveAlone: false, everyoneCanWalk: true, people: 2, oxygen: false };
  const save = afterSave({ choice: "2", people: 2, oxygen: false });
  const summary = "Your answers are recorded: you need a ride and can walk to a vehicle for 2 people, with no oxygen needed.";
  assert.equal(decideTurn(facts, save, context(state, { category: "flood" })).content, `${summary} Is water entering your home?`);
  assert.equal(decideTurn({ ...facts, hazardQuestionsAnswered: [0] }, { ...save, lastWasSave: false, residentJustSpoke: true }, context(state, { category: "flood" })).content, "Is floodwater blocking your exits?");
  const independent = { ...nothing, canLeaveAlone: true, people: 1, oxygen: false };
  assert.ok(String(decideTurn(independent, afterSave({ choice: "1", people: 1, oxygen: false }), context(saved("1", 1, false), { category: "flood" })).content).endsWith(SPEECH.offerDispatcher));
});

test("declining the dispatcher closes with safety guidance and hangs up, accepting requests then transfers", () => {
  const state = saved("1", 1, false), facts = { ...nothing, canLeaveAlone: true, people: 1, oxygen: false };
  const offered: Conversation = { agentLines: [SPEECH.offerDispatcher], toolRequests: [{ name: "record_assessment", args: { choice: "1", people: 1, oxygen: false } }], lastWasSave: false, residentJustSpoke: true };
  const declined = decideTurn({ ...facts, wantsDispatcher: false }, offered, context(state));
  assert.equal(declined.content, SPEECH.leaving);
  assert.deepEqual(toolNames(declined), ["end_call"]);
  assert.deepEqual(toolNames(decideTurn({ ...facts, wantsDispatcher: true }, offered, context(state))), ["request_handoff"]);
  const transfer = decideTurn({ ...facts, wantsDispatcher: true }, offered, context({ ...state, handoffStatus: "requested" }));
  assert.deepEqual(toolNames(transfer), ["transfer_to_number"]);
  assert.equal(JSON.parse(transfer.tool_calls![0].function.arguments).transfer_number, "+12142009999");
  const failed = decideTurn({ ...facts, wantsDispatcher: true }, { ...offered, toolRequests: [...offered.toolRequests, { name: "transfer_to_number", args: {} }] }, context({ ...state, handoffStatus: "requested" }));
  assert.equal(failed.content, `${SPEECH.transferFailed} ${SPEECH.leaving}`);
});

test("no transfer happens without an offer, even if the model reports the resident wants one", () => {
  const facts = { ...nothing, canLeaveAlone: true, people: 1, oxygen: false, wantsDispatcher: true };
  const notOffered: Conversation = { ...afterSave({ choice: "1", people: 1, oxygen: false }), lastWasSave: false, residentJustSpoke: true };
  const turn = decideTurn(facts, notOffered, context(saved("1", 1, false)));
  assert.equal(turn.content, SPEECH.offerDispatcher);
  assert.deepEqual(toolNames(turn), []);
});

test("an off-script answer is spoken once, not again after a tool result", () => {
  const facts = { ...nothing, latest: "policy_question" as const, canLeaveAlone: true, people: 2, oxygen: false };
  const first = decideTurn(facts, start, context());
  assert.equal(first.content, SPEECH.policyUnknown);
  assert.deepEqual(toolNames(first), ["record_assessment"]);
  const afterTool = decideTurn(facts, afterSave({ choice: "1", people: 2, oxygen: false }), context(saved("1", 2, false)));
  assert.ok(!String(afterTool.content).includes(SPEECH.policyUnknown));
  assert.ok(String(afterTool.content).endsWith(SPEECH.offerDispatcher));
});

test("emergency, refusal and voicemail stop the survey at any point", () => {
  for (const [latest, line] of [["emergency", SPEECH.emergency], ["refusal", SPEECH.refusal], ["language_barrier", SPEECH.interpreter]] as const) {
    const turn = decideTurn({ ...nothing, latest, canLeaveAlone: true, people: 1, oxygen: false }, start, context());
    assert.equal(turn.content, line);
    assert.deepEqual(toolNames(turn), ["end_call"]);
  }
  assert.deepEqual(toolNames(decideTurn({ ...nothing, latest: "voicemail" }, start, context())), ["voicemail_detection"]);
});

test("off-script questions get the approved answer and the survey carries on", () => {
  const facts = { ...nothing, canLeaveAlone: false };
  assert.equal(decideTurn({ ...facts, latest: "medical_question" }, start, context()).content, `${SPEECH.medicalUnknown} ${SPEECH.walking}`);
  assert.equal(decideTurn({ ...facts, latest: "policy_question" }, start, context()).content, `${SPEECH.policyUnknown} ${SPEECH.walking}`);
  assert.equal(decideTurn({ ...facts, latest: "status_question" }, start, context()).content, `${SPEECH.noAssignment} ${SPEECH.walking}`);
  const state: ResidentSpeechState = { ride: null, assessmentRecorded: true, requestStatus: "received" };
  assert.equal(decideTurn({ ...facts, latest: "status_question" }, start, context(state)).content, `${statusLine("received", null)} ${SPEECH.walking}`);
});

test("a question that stays unanswered is not asked forever", () => {
  const twice: Conversation = { agentLines: [SPEECH.clarify, SPEECH.clarify, SPEECH.people, SPEECH.people, SPEECH.oxygen, SPEECH.oxygen], toolRequests: [], lastWasSave: false, residentJustSpoke: true };
  const turn = decideTurn({ ...nothing, latest: "unclear" }, twice, context());
  assert.equal(turn.content, SPEECH.persistenceUnknown);
  assert.deepEqual(toolNames(turn), ["end_call"]);
  const unknownCount = decideTurn({ ...nothing, canLeaveAlone: true, oxygen: false }, { ...twice, agentLines: [SPEECH.people, SPEECH.people] }, context());
  assert.deepEqual(JSON.parse(unknownCount.tool_calls![0].function.arguments), { choice: "1", oxygen: false });
});

test("a call that cannot be saved says so instead of claiming it was", () => {
  const facts = { ...nothing, canLeaveAlone: true, people: 1, oxygen: false };
  assert.equal(decideTurn(facts, start, context(undefined, { bound: false })).content, SPEECH.persistenceUnknown);
});

test("callbacks read the current status once and hang up", () => {
  const turn = decideTurn(nothing, { agentLines: [SPEECH.callbackFirst], toolRequests: [], lastWasSave: false, residentJustSpoke: true }, context({ ride: null, assessmentRecorded: true, requestStatus: "received" }, { kind: "callback" }));
  assert.equal(turn.content, statusLine("received", null));
  assert.deepEqual(toolNames(turn), ["end_call"]);
});

test("everything the decision speaks passes the honesty guard", () => {
  const state = saved("3", 2, true);
  const facts = { ...nothing, canLeaveAlone: false, wheelchair: true, people: 2, oxygen: true };
  const save = afterSave({ choice: "3", people: 2, oxygen: true });
  const turns = [
    decideTurn(facts, save, context(state)), decideTurn(facts, save, context(state, { category: "wildfire" })),
    decideTurn({ ...facts, latest: "status_question" }, save, context(state)), decideTurn({ ...facts, wantsDispatcher: false }, save, context(state)),
    decideTurn({ ...facts, latest: "floodwater_question", wantsDispatcher: false }, save, context(state)),
    decideTurn({ ...nothing, latest: "medical_question" }, start, context()), decideTurn({ ...nothing, latest: "refusal" }, start, context()),
  ];
  for (const turn of turns) if (turn.content) assert.equal(guardResidentTurn(turn.content, state).blocked, false, String(turn.content));
});

test("malformed model output reads as not stated", () => {
  assert.deepEqual(parseUnderstanding("nonsense"), { ...nothing, latest: "unclear" });
  const parsed = parseUnderstanding({ latest: "promise a driver", can_leave_alone: "yes", people: 500, oxygen: 1, hazard_questions_answered: [1, "x"] });
  assert.deepEqual(parsed, { ...nothing, latest: "unclear", hazardQuestionsAnswered: [1] });
});
