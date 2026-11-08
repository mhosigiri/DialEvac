import type { RequestStatus } from "./status";

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
