import { test } from "node:test";
import assert from "node:assert/strict";
import { dialSingleHoustonResident } from "../src/single-demo-call";
import type { Contract } from "../src/contract";
import { HOUSTON_DEMO } from "../../shared/demo";

const phones = ["+12145553841", "+16825555303", "+14695554623"];
const call = { id: 5n, householdId: 9n, purpose: "survey", phase: "queued", priority: 1 };
const home = { ...HOUSTON_DEMO, id: 9n, simulated: true, language: "en" };
test("single-call demo claims once and dials only the selected resident, never the human destination", async () => {
  let claimed = false;
  const dialed: string[] = [];
  const db = { claimCall: async () => { if (claimed) throw new Error("changed"); claimed = true; }, callEnded: async () => undefined } as unknown as Contract;
  const dial = async (phone: string) => { dialed.push(phone); return "conversation-test"; };
  await dialSingleHoustonResident(db, call, home, phones, dial);
  await assert.rejects(dialSingleHoustonResident(db, call, home, phones, dial), /changed/);
  assert.deepEqual(dialed, [phones[1]]);
});

test("single-call demo refuses other profiles and records a failed dial without retrying", async () => {
  let calls = 0, ended = "";
  const db = { claimCall: async () => undefined, callEnded: async (_id: bigint, outcome: string) => { ended = outcome; } } as unknown as Contract;
  const dial = async () => { calls++; throw new Error("provider unavailable"); };
  await assert.rejects(dialSingleHoustonResident(db, call, { ...home, simulated: false }, phones, dial), /synthetic Houston/);
  assert.equal(calls, 0);
  await assert.rejects(dialSingleHoustonResident(db, call, home, phones, dial), /provider unavailable/);
  assert.equal(calls, 1);
  assert.equal(ended, "failed");
});
