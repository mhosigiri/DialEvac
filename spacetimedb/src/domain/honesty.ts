import type { RequestStatus } from "./status";
import { SURVEY_ASK, SURVEY_INTRO } from "./script";
import { CATASTROPHES, TRIAGE } from "../../../shared/catastrophe-triage";

// What the agent may say about a ride, chosen by the request's status. Code picks these lines; a
// model never writes a promise. Every channel (voice, Photon messages) reads them from here.

export type Ride = { driverName: string; vehicleKind: string; crew: number; etaMinutes: number };

const SAFETY = "If you can leave safely, leave now. If the danger reaches your home, call 911.";

export function statusLine(status: RequestStatus, ride: Ride | null): string {
  switch (status) {
    case "received":
    case "approved":
      return `Your assistance request is recorded. No driver has accepted yet. ${SAFETY}`;
    case "driver_accepted":
    case "en_route":
      if (!ride || !Number.isFinite(ride.etaMinutes) || ride.etaMinutes < 0) return "Your assistance request is recorded. I cannot verify the current driver details or arrival estimate.";
      return `A ${label(ride.vehicleKind, "response vehicle")} with a ${crewWords(ride.crew)} crew ${status === "en_route" ? "is recorded as en route" : "has accepted your request"}. The driver's name is ${label(ride.driverName, "the assigned responder")}. The current estimated arrival is about ${ride.etaMinutes} minutes; this estimate can change.`;
    case "reassigning":
      return `Your previous assignment is no longer active. A replacement driver has not accepted yet. ${SAFETY}`;
    case "arrived":
      return "Your driver has arrived.";
    case "closed":
      return "This assistance request is closed.";
  }
}

function crewWords(crew: number) {
  return crew >= 2 ? "two-person" : "one-person";
}

function label(value: string, fallback: string) {
  const text = value.replace(/[^\p{L}\p{N} '-]/gu, "").trim().slice(0, 80);
  return text && !soundsLikePromise(text) ? text : fallback;
}

// Free text a model wrote may acknowledge the resident, never promise help.
const PROMISE = /\b(on (their|the|its) way|coming (for|to get) you|help is coming|they('| a)re coming|will be there|don'?t worry|be there (soon|shortly)|someone('s| is) coming)\b/i;

export function soundsLikePromise(text: string) {
  return PROMISE.test(text);
}

export type SurveyChoice = "1" | "2" | "3" | "4";
export function isSurveyChoice(value: unknown): value is SurveyChoice { return value === "1" || value === "2" || value === "3" || value === "4"; }
export type ResidentSpeechState = { assessment?: { choice: SurveyChoice; people?: number; oxygen?: boolean }; requestStatus?: RequestStatus; ride: Ride | null; canLeave?: boolean; assessmentRecorded: boolean; warningActive?: boolean; handoffStatus?: string };
export const SPEECH = {
  first: "This is the automated emergency response line. Are you able to leave your home safely on your own?",
  demoFirst: "This is a simulated catastrophe response demonstration. Are you able to leave your demo home safely, or would you need assistance?",
  callbackFirst: "This is the automated emergency response line. I am checking the latest recorded update for your household.",
  hearing: "I can hear you. Please continue.",
  checking: "I’m checking your answers.",
  people: "How many people need assistance?",
  oxygen: "Does anyone in your household use oxygen?",
  walking: "Can everyone who needs a ride walk to a vehicle?",
  offerDispatcher: "Would you like to speak with a dispatcher?",
  mobility: "What help does each person need to reach a vehicle?",
  wheelchair: "Does anyone use a wheelchair?",
  lifting: "Does anyone need to be lifted or carried?",
  difficulty: "What is making it difficult for you to leave?",
  clarify: "Are you able to leave on your own, or do you need transport assistance?",
  unverified: "I cannot verify a rescue assignment right now. Are you able to leave safely, or do you need assistance?",
  recorded: "Your answers have been recorded. You can ask to speak with a dispatcher.",
  leaving: "Thank you. Leave now if you can do it safely.",
  goodbye: "Thank you for speaking with the response line. Goodbye.",
  voicemail: "This is the automated emergency response line. Please call the response line when you can.",
  transfer: "I am attempting to connect you to a dispatcher. A connection is not yet confirmed.",
  policyUnknown: "I don't know. Please confirm that with the human dispatcher.",
  emergency: "This is an automated outreach assistant, not 911. Please call 911 now for an immediate emergency.",
  medicalUnknown: "I cannot provide medication or treatment instructions. Please ask a qualified medical professional.",
  floodwater: "Do not drive or walk through floodwater. I cannot confirm a safe route for you.",
  persistenceUnknown: "I heard your request, but I cannot confirm it has been saved yet.",
  interpreter: "I can only assist in English. Please ask for a human interpreter; I cannot confirm an interpreter connection.",
  refusal: "I understand that you do not want to continue the survey. Goodbye.",
  noAssignment: "I cannot verify a rescue assignment right now.",
  transferFailed: "I could not connect you to a dispatcher.",
} as const;

export function assessmentSummary(assessment: NonNullable<ResidentSpeechState["assessment"]>) {
  const transport = { "1": "you can leave independently", "2": "you need a ride and can walk to a vehicle", "3": "you need wheelchair-accessible transport", "4": "someone needs to be lifted or carried" }[assessment.choice];
  const people = assessment.people;
  const count = people !== undefined && Number.isInteger(people) && people > 0 && people < 50 ? ` for ${people} ${people === 1 ? "person" : "people"}` : "";
  const oxygen = assessment.oxygen === true ? ", with oxygen needed" : assessment.oxygen === false ? ", with no oxygen needed" : "";
  return `Your answers are recorded: ${transport}${count}${oxygen}.`;
}

export function approvedResidentPhrases(state?: ResidentSpeechState, channel: "voice" | "message" = "voice") {
  const allowed: string[] = [SPEECH.policyUnknown, SPEECH.emergency, SPEECH.medicalUnknown, SPEECH.floodwater];
  if (channel === "message") allowed.push(SURVEY_ASK);
  if (channel === "voice") allowed.push(SPEECH.noAssignment, SPEECH.transferFailed, SPEECH.wheelchair, SPEECH.lifting, SPEECH.difficulty, SPEECH.walking, SPEECH.hearing, SPEECH.checking, SPEECH.first, SPEECH.demoFirst, SPEECH.callbackFirst, SPEECH.people, SPEECH.oxygen, SPEECH.mobility, SPEECH.clarify, SPEECH.unverified, SPEECH.goodbye, SPEECH.voicemail);
  if (channel === "voice") allowed.push(SPEECH.persistenceUnknown, SPEECH.interpreter, SPEECH.refusal, "What danger are you experiencing at your home?", ...CATASTROPHES.flatMap(category => TRIAGE[category].questions));
  if (channel === "message" && state?.warningActive) allowed.push(`${SURVEY_INTRO} ${SURVEY_ASK}`);
  if (state?.canLeave === true) allowed.push(SPEECH.leaving);
  if (channel === "voice" && state?.assessmentRecorded) {
    allowed.push(SPEECH.recorded, SPEECH.offerDispatcher);
    if (state.assessment) allowed.push(assessmentSummary(state.assessment));
  }
  if (channel === "voice" && ["requested", "ringing"].includes(state?.handoffStatus ?? "")) allowed.push(SPEECH.transfer);
  if (state?.requestStatus) allowed.push(statusLine(state.requestStatus, state.ride));
  return allowed;
}

// Exact, state-derived phrases are the release boundary. Regex detection alone cannot cover
// every way a model might invent a dispatch, ETA, medical recommendation or successful action.
export function guardResidentTurn(candidate: unknown, state?: ResidentSpeechState, channel: "voice" | "message" = "voice") {
  const text = typeof candidate === "string" ? candidate.trim() : "";
  const promise = soundsLikePromise(text); // Invoked on every proposed turn, including safe turns.
  const phrases = approvedResidentPhrases(state, channel);
  const composed = channel === "voice" && (text.match(/\?/g)?.length ?? 0) <= 1 && phrases.some(first => text.startsWith(`${first} `) && phrases.includes(text.slice(first.length + 1)));
  const approved = phrases.includes(text) || composed;
  const replacement = state?.requestStatus ? statusLine(state.requestStatus, state.ride) : SPEECH.unverified;
  return { text: approved ? text : replacement, blocked: !approved, reason: approved ? "approved_template" : promise ? "unverified_promise" : "not_a_current_template" };
}
