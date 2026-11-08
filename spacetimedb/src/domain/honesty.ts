import type { RequestStatus } from "./status";
import { SURVEY_ASK, SURVEY_INTRO } from "./script";

// What the agent may say about a ride, chosen by the request's status. Code picks these lines; a
// model never writes a promise. Every channel (voice, Photon messages) reads them from here.

export type Ride = { driverName: string; vehicleKind: string; crew: number; etaMinutes: number };

const SAFETY = "If you can leave safely, leave now. If the danger reaches your home, call 911.";

export function statusLine(status: RequestStatus, ride: Ride | null): string {
  switch (status) {
    case "received":
    case "approved":
      return `You're on the rescue list as high priority. No driver has accepted yet. I'll contact you the moment one does. ${SAFETY}`;
    case "driver_accepted":
    case "en_route":
      if (!ride) return statusLine("received", null);
      return `A ${ride.vehicleKind} with a ${crewWords(ride.crew)} crew is ${ride.etaMinutes} minutes away. The driver's name is ${ride.driverName}. I'll contact you again if anything changes.`;
    case "reassigning":
      return `Your driver can no longer reach you. You're still at the top of the list. I'll contact you the moment a new driver accepts. ${SAFETY}`;
    case "arrived":
      return "Your driver has arrived.";
    case "closed":
      return "Your pickup is complete.";
  }
}

function crewWords(crew: number) {
  return crew >= 2 ? "two-person" : "one-person";
}

// Free text a model wrote may acknowledge the resident, never promise help.
const PROMISE = /\b(on (their|the|its) way|coming (for|to get) you|help is coming|they('| a)re coming|will be there|don'?t worry|be there (soon|shortly)|someone('s| is) coming)\b/i;

export function soundsLikePromise(text: string) {
  return PROMISE.test(text);
}

export type ResidentSpeechState = { requestStatus?: RequestStatus; ride: Ride | null; canLeave?: boolean; assessmentRecorded: boolean; warningActive?: boolean; handoffStatus?: string };
export const SPEECH = {
  first: "This is the automated emergency response line. Are you able to leave your home safely on your own?",
  demoFirst: "This is a simulated catastrophe response demonstration. Are you able to leave your demo home safely, or would you need assistance?",
  callbackFirst: "This is the automated emergency response line. I am checking the latest recorded update for your household.",
  people: "How many people need assistance?",
  oxygen: "Does anyone in your household use oxygen?",
  mobility: "Does anyone need a wheelchair-accessible vehicle, or need to be lifted or carried?",
  clarify: "Are you able to leave on your own, or do you need transport assistance?",
  unverified: "I cannot verify a rescue assignment right now. Are you able to leave safely, or do you need assistance?",
  recorded: "Your answers have been recorded. You can ask to speak with a dispatcher.",
  leaving: "Thank you. Leave now if you can do it safely.",
  goodbye: "Thank you for speaking with the response line. Goodbye.",
  voicemail: "This is the automated emergency response line. Please call the response line when you can.",
  transfer: "I am attempting to connect you to a dispatcher. A connection is not yet confirmed.",
} as const;

export function approvedResidentPhrases(state?: ResidentSpeechState, channel: "voice" | "message" = "voice") {
  const allowed: string[] = [SURVEY_ASK];
  if (channel === "voice") allowed.push(SPEECH.first, SPEECH.demoFirst, SPEECH.callbackFirst, SPEECH.people, SPEECH.oxygen, SPEECH.mobility, SPEECH.clarify, SPEECH.unverified, SPEECH.goodbye, SPEECH.voicemail);
  if (state?.warningActive) allowed.push(`${SURVEY_INTRO} ${SURVEY_ASK}`);
  if (state?.canLeave === true) allowed.push(SPEECH.leaving);
  if (channel === "voice" && state?.assessmentRecorded) allowed.push(SPEECH.recorded);
  if (channel === "voice" && ["requested", "ringing"].includes(state?.handoffStatus ?? "")) allowed.push(SPEECH.transfer);
  if (state?.requestStatus) allowed.push(statusLine(state.requestStatus, state.ride));
  return allowed;
}

// Exact, state-derived phrases are the release boundary. Regex detection alone cannot cover
// every way a model might invent a dispatch, ETA, medical recommendation or successful action.
export function guardResidentTurn(candidate: unknown, state?: ResidentSpeechState, channel: "voice" | "message" = "voice") {
  const text = typeof candidate === "string" ? candidate.trim() : "";
  const promise = soundsLikePromise(text); // Invoked on every proposed turn, including safe turns.
  const approved = approvedResidentPhrases(state, channel).includes(text);
  const replacement = state?.requestStatus ? statusLine(state.requestStatus, state.ride) : SPEECH.unverified;
  return { text: approved ? text : replacement, blocked: !approved, reason: approved ? "approved_template" : promise ? "unverified_promise" : "not_a_current_template" };
}
