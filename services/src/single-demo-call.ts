import type { Contract, CallRow, HouseholdRow } from "./contract";
import type { CallVariables } from "./elevenlabs";
import { demoContacts } from "./demo-handoff";
import { HOUSTON_DEMO } from "../../shared/demo";

export async function dialSingleHoustonResident(db: Contract, call: CallRow, home: HouseholdRow & { riderId: string; simulated: boolean },
  allowlist: readonly string[], dial: (phone: string, variables: CallVariables) => Promise<string>) {
  const target = demoContacts(allowlist);
  if (!home.simulated || home.riderId !== HOUSTON_DEMO.riderId || home.phone !== HOUSTON_DEMO.phone || call.householdId !== home.id || call.phase !== "queued" || call.purpose !== "survey") {
    throw new Error("Only the queued synthetic Houston resident can be dialed by this command");
  }
  // Claim commits before the external side effect; repeated CLI execution cannot place it again.
  await db.claimCall(call.id, "elevenlabs");
  try { return await dial(target.resident, { kind: "survey", call_id: String(call.id), callback_id: "", name: "Anish" }); }
  catch (error) { await db.callEnded(call.id, "failed"); throw error; }
}
