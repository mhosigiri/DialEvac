import { classifyCatastrophe, TRIAGE, type Catastrophe } from "../../../shared/catastrophe-triage";

export type Speaker = "resident" | "agent" | "dispatcher";
export type Turn = { speaker: Speaker; text: string; start: number; end: number };
export type OutreachCall = { id: number; name: string; address: string; startsAt: number; outcome: "assessed" | "handoff" | "door_check"; observation: string; turns: Turn[] };
export type CallPhase = "queued" | "ringing" | "live" | "assessed" | "handoff" | "door_check";
export type Session = { version: 1; category: Catastrophe; size: number; elapsed: number; speed: number; selected: number };
const NAMES = ["Maya Chen", "James Williams", "Sofia Garcia", "Robert Davis", "Anish Patel", "Evelyn Brooks", "Noah Wilson", "Isabella Nguyen", "Henry Thomas", "Amelia Martinez", "Oliver Reed", "Charlotte Kim"];
const STREETS = ["Memorial Drive", "Buffalo Bayou Lane", "Montrose Boulevard", "Allen Parkway", "West Gray Street", "Waugh Drive"];
const OBSERVATIONS: Record<Catastrophe, string> = {
  flood: "The bayou is overflowing. Rising water is coming into our street.",
  wildfire: "There is heavy smoke outside. I can see flames near the tree line.",
  hurricane: "The hurricane has damaged our roof. We have lost power.",
  tornado: "A tornado came through our neighborhood. Part of the roof has collapsed.",
};
const ANSWERS: Record<Catastrophe, readonly string[]> = {
  flood: ["Water is entering the ground floor.", "The front exit is blocked by floodwater.", "My mother uses a wheelchair and needs help moving upstairs."],
  wildfire: ["There are flames behind our street and heavy smoke.", "My father says the smoke is affecting his breathing.", "We need an accessible ride for my mother's wheelchair."],
  hurricane: ["The roof is damaged and windows are broken.", "Yes, the power has been out for an hour.", "My mother uses an oxygen concentrator with a backup battery."],
  tornado: ["The roof and one outside wall are damaged.", "My mother cannot reach the shelter space in her wheelchair.", "Everyone is together; nobody is trapped or injured."],
};

export function createCalls(category: Catastrophe, size: number): OutreachCall[] {
  return Array.from({ length: size }, (_, id) => {
    const outcome = id % 13 === 12 ? "door_check" : id % 5 === 0 ? "handoff" : "assessed";
    const assisted = outcome === "handoff" || id % 3 === 0;
    const content: { speaker: Speaker; text: string }[] = [
      { speaker: "agent", text: "This is the automated emergency response line. What danger are you experiencing at your home?" },
      { speaker: "resident", text: OBSERVATIONS[category] },
      { speaker: "agent", text: TRIAGE[category].questions[0] },
      { speaker: "resident", text: ANSWERS[category][0] },
      { speaker: "agent", text: assisted ? TRIAGE[category].questions[2] : TRIAGE[category].questions[1] },
      { speaker: "resident", text: assisted ? ANSWERS[category][2] : ANSWERS[category][1] },
      { speaker: "agent", text: "How many people need assistance?" },
      { speaker: "resident", text: `${2 + id % 4} people. ${assisted ? "We need a wheelchair-accessible ride." : "We can leave on our own if it is safe."}` },
      { speaker: "agent", text: "Does anyone in your household use oxygen?" },
      { speaker: "resident", text: assisted ? "Yes, my mother uses oxygen." : "No, nobody uses oxygen." },
      { speaker: "agent", text: "Your assessment is recorded. No driver has accepted a request yet." },
    ];
    if (outcome === "handoff") content.push(
      { speaker: "resident", text: "Please connect me with a dispatcher." },
      { speaker: "agent", text: "Connecting you to a dispatcher now." },
      { speaker: "dispatcher", text: "I am reviewing your wheelchair and oxygen needs. Can you confirm the pickup address?" },
      { speaker: "resident", text: `${120 + id * 7} ${STREETS[id % STREETS.length]}, Houston.` },
      { speaker: "dispatcher", text: "Thank you. Your request is in the priority review queue. A vehicle assignment is not confirmed yet." },
    );
    const startsAt = Math.floor(id / 18) * 3800 + (id % 18) * 160;
    const pace = 0.88 + (id % 7) * 0.055;
    let at = startsAt + 1800 + (id % 4) * 300;
    const turns = outcome === "door_check" ? [] : content.map(turn => {
      const start = at;
      at += Math.round((1000 + turn.text.length * 17) * pace);
      const end = at;
      at += Math.round(280 * pace);
      return { ...turn, start, end };
    });
    return { id, name: NAMES[id % NAMES.length], address: `${120 + id * 7} ${STREETS[id % STREETS.length]}`, startsAt, observation: OBSERVATIONS[category], outcome, turns };
  });
}

export function callPhase(call: OutreachCall, elapsed: number): CallPhase {
  if (elapsed < call.startsAt) return "queued";
  if (call.outcome === "door_check") return elapsed < call.startsAt + 9000 ? "ringing" : "door_check";
  if (elapsed < call.turns[0].start) return "ringing";
  if (elapsed < call.turns[call.turns.length - 1].end) return "live";
  return call.outcome;
}
export function visibleTurns(call: OutreachCall, elapsed: number) {
  return call.turns.filter(turn => turn.start <= elapsed).map(turn => ({ ...turn, final: elapsed >= turn.end,
    text: turn.text.slice(0, Math.max(1, Math.floor(turn.text.length * Math.min(1, (elapsed - turn.start) / (turn.end - turn.start))))) }));
}
export function callClassification(call: OutreachCall, elapsed: number) {
  const observation = call.turns[1];
  return observation && elapsed >= observation.end ? classifyCatastrophe(call.observation) : { kind: "unknown" } as const;
}
export function durationOf(calls: OutreachCall[]) {
  return Math.max(0, ...calls.map(call => call.outcome === "door_check" ? call.startsAt + 9000 : call.turns[call.turns.length - 1].end)) + 500;
}
export function sessionFrom(value: unknown): Session | undefined {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("category" in value) ||
    !["flood", "wildfire", "hurricane", "tornado"].includes(String(value.category)) || !("size" in value) || ![72, 144, 288].includes(Number(value.size)) ||
    !("elapsed" in value) || typeof value.elapsed !== "number" || !Number.isFinite(value.elapsed) || value.elapsed < 0 || value.elapsed > 300_000 ||
    !("speed" in value) || ![1, 2, 4].includes(Number(value.speed)) || !("selected" in value) || !Number.isInteger(value.selected) || Number(value.selected) < 0 || Number(value.selected) >= Number(value.size)) return;
  // Reconstruct validated values; no persisted object is trusted as a session.
  const category = value.category;
  if (category !== "flood" && category !== "wildfire" && category !== "hurricane" && category !== "tornado") return;
  return { version: 1, category, size: Number(value.size), elapsed: value.elapsed, speed: Number(value.speed), selected: Number(value.selected) };
}

let database: Promise<IDBDatabase> | undefined;
function localDatabase() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("dialevac-rehearsal", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("sessions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readSession(): Promise<Session | undefined> {
  const db = await localDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("sessions").objectStore("sessions").get("current");
    request.onsuccess = () => resolve(sessionFrom(request.result));
    request.onerror = () => reject(request.error);
  });
}
export async function saveSession(session: Session): Promise<void> {
  const db = await localDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").put(session, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
