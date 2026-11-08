import { test } from "node:test";
import assert from "node:assert/strict";
import { SPACETIME_DATABASE, SPACETIME_DATABASE_ID, SPACETIME_DEMO_DATABASE, SPACETIME_URI, separateDemoDatabase } from "../../shared/spacetime";
import { transcriptsForHousehold } from "../../dispatchers-portal/src/lib/data";
import { env } from "../src/env";

test("services default to the shared remote database when overrides are absent", () => {
  const previous = { uri: process.env.SPACETIME_URI, database: process.env.SPACETIME_DATABASE };
  try {
    delete process.env.SPACETIME_URI;
    delete process.env.SPACETIME_DATABASE;
    assert.equal(env.spacetime.uri(), SPACETIME_URI);
    assert.equal(env.spacetime.database(), SPACETIME_DATABASE);
  } finally {
    for (const [key, value] of Object.entries({ SPACETIME_URI: previous.uri, SPACETIME_DATABASE: previous.database })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("the remote demo target is separate and rejects the operational name and identity", () => {
  assert.equal(separateDemoDatabase(SPACETIME_URI, SPACETIME_DEMO_DATABASE, SPACETIME_URI, SPACETIME_DATABASE), true);
  for (const database of [SPACETIME_DATABASE, SPACETIME_DATABASE_ID]) {
    assert.equal(separateDemoDatabase("https://maincloud.spacetimedb.com", database, SPACETIME_URI, SPACETIME_DATABASE), false);
  }
  assert.equal(separateDemoDatabase(SPACETIME_URI, "custom-operations", SPACETIME_URI, "custom-operations"), false);
  assert.equal(separateDemoDatabase("invalid-url", "demo", SPACETIME_URI, SPACETIME_DATABASE), false);
});

test("transcript rows only join through calls belonging to the selected household", () => {
  const lines = [{ callId: 11n, text: "first call" }, { callId: 12n, text: "second call" }, { callId: 13n, text: "other household" }, { callId: 99n, text: "unknown call" }];
  const calls = [{ id: 11n, householdId: 1n }, { id: 12n, householdId: 1n }, { id: 13n, householdId: 2n }];
  assert.deepEqual(transcriptsForHousehold(lines, calls, 1n), lines.slice(0, 2));
  assert.deepEqual(transcriptsForHousehold(lines, calls, 2n), [lines[2]]);
  assert.deepEqual(transcriptsForHousehold(lines, calls, 3n), []);
  assert.deepEqual(transcriptsForHousehold(lines, calls, undefined), []);
});
