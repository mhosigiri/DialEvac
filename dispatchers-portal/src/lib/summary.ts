import type { Household, Request } from "../module_bindings/types";

/**
 * Generates an executive emergency dispatch summary for first responders
 * based on the household's triage attributes and call data.
 */
export function generateEmergencySummary(
  household: Household,
  request?: Request
): { summary: string; urgency: "critical" | "high" | "medium" | "low" } {
  const people = request?.people ?? household.people;
  const oxygen = request?.oxygen ?? household.oxygen;
  const mobility = request?.mobility ?? household.mobility;
  const escalation = request?.escalation;

  if (escalation) {
    return {
      summary: `ESCALATED: ${escalation.toUpperCase()} — Special team required for ${people} occupants at ${household.address}.`,
      urgency: "critical",
    };
  }

  if (mobility === "bedbound" || (oxygen && mobility === "wheelchair")) {
    return {
      summary: `CRITICAL MEDICAL: ${people} occupant(s). Resident is ${mobility === "bedbound" ? "bedbound (requires stretcher/lift)" : "in wheelchair"} and oxygen-dependent. Dispatched unit must have medical equipment onboard.`,
      urgency: "critical",
    };
  }

  if (oxygen) {
    return {
      summary: `HIGH MEDICAL: ${people} occupant(s). Life-critical continuous oxygen equipment in use. Rapid pickup recommended prior to power failure.`,
      urgency: "high",
    };
  }

  if (mobility === "wheelchair") {
    return {
      summary: `ACCESSIBLE TRANSPORT: ${people} occupant(s). Requires wheelchair ramp or hydraulic lift vehicle. Ambulatory assistance needed.`,
      urgency: "high",
    };
  }

  if (household.canLeave === false) {
    return {
      summary: `EVACUATION ASSIST: ${people} occupant(s) unable to self-evacuate. Resident is ambulatory and can walk to standard vehicle.`,
      urgency: "medium",
    };
  }

  if (household.canLeave === true) {
    return {
      summary: `SELF-EVACUATING: Resident confirmed household can leave independently. No emergency ride vehicle required.`,
      urgency: "low",
    };
  }

  return {
    summary: `AWAITING SURVEY: AI voice agent currently reaching resident at ${household.phone}.`,
    urgency: "medium",
  };
}
