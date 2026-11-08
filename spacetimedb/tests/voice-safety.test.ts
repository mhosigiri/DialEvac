import { describe, expect, it } from "vitest";
import { guardResidentTurn, SPEECH } from "../src/domain/honesty";

describe("voice safety responses through the release gate", () => {
  it("releases uncertainty and emergency redirection without requiring a known household", () => {
    for (const phrase of [SPEECH.policyUnknown, SPEECH.emergency, SPEECH.medicalUnknown, SPEECH.floodwater, SPEECH.persistenceUnknown, SPEECH.interpreter, SPEECH.refusal]) {
      expect(guardResidentTurn(phrase)).toMatchObject({ blocked: false, text: phrase });
    }
  });

  it("rejects invented policy or successful persistence while preserving the approved fallback", () => {
    for (const phrase of ["Your insurance covers every hotel stay.", "Dogs are allowed at all shelters.", "Your request was saved and an ambulance is on its way."]) {
      expect(guardResidentTurn(phrase).blocked).toBe(true);
    }
    expect(guardResidentTurn(SPEECH.policyUnknown, { ride: null, assessmentRecorded: true, requestStatus: "received" }).text).toBe(SPEECH.policyUnknown);
    expect(guardResidentTurn(SPEECH.recorded).blocked).toBe(true);
  });
});
