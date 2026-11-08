import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import type { DbConnection } from "./module_bindings";

export async function runHoustonSimulation(conn: DbConnection, options: { hazard: string; runId: string; stage: "queued" | "assessed" | "routed" | "closed"; pauseMs?: number }, report = console.log) {
  const { runId, stage } = options;
  const hazard = options.hazard === "fire" ? "wildfire" : options.hazard;
  assert(["hurricane", "flood", "wildfire"].includes(hazard), "Choose hurricane, flood or fire");
  const evidence = async (name: string, facts: object) => { report(`${name}: ${JSON.stringify(facts, (_key, value) => typeof value === "bigint" ? value.toString() : value)}`); if (options.pauseMs) await sleep(options.pauseMs); };
  await conn.reducers.prepareHoustonDemo({});
  await conn.reducers.simulateCatastrophe({ hazard, runId });
  const home = [...conn.db.household.iter()].find(h => h.riderId === `demo-houston-run-${runId}`)!;
  assert(home?.simulated && /^\+1\d{3}555\d{4}$/.test(home.phone), "Simulation requires a fictional synthetic resident");
  const member = conn.db.catastropheCase.householdId.find(home.id)!;
  const zone = conn.db.zone.id.find(member.zoneId)!;
  assert(zone.active && JSON.parse(zone.geometryJson!).type === "Polygon");
  const queued = [...conn.db.catastropheCase.zoneId.filter(zone.id)].filter(c => c.callId !== undefined && conn.db.call.id.find(c.callId)?.phase === "queued");
  await evidence("1 catastrophe and spatial match", { hazard, zoneId: zone.id, geometry: "GeoJSON Polygon", householdId: home.id, queuedCalls: queued.map(c => c.callId), realContact: false });
  if (stage === "queued") return home.id;
  for (const c of queued) await conn.reducers.simulateAssessment({ householdId: c.householdId });
  const call = conn.db.call.id.find(member.callId!)!;
  const request = [...conn.db.request.iter()].find(r => r.householdId === home.id)!;
  assert(request && call.phase === "ended" && call.outcome === "simulated_answered");
  await evidence("2 simulated assessment", { callId: call.id, phase: call.phase, requestId: request.id, status: request.status,
    transcriptLines: [...conn.db.transcriptLine.iter()].filter(t => t.callId === call.id).length });
  if (stage === "assessed") return home.id;
  await conn.reducers.matchClosestDispatcher({ requestId: request.id });
  const assignment = [...conn.db.assignment.iter()].find(a => a.requestId === request.id && ["proposed", "offered", "accepted"].includes(a.status));
  assert(assignment, "No capable free resource; release the prior accepted demo case before rehearsing");
  const vehicle = conn.db.vehicle.id.find(assignment.vehicleId)!;
  assert(vehicle.simulated, "Rehearsal cannot use a real vehicle");
  await evidence("3 closest capable free resource", { assignmentId: assignment.id, vehicleId: vehicle.id, label: vehicle.name, status: assignment.status });
  // Explicitly simulated dispatcher/driver actions; ordinary portal users still approve each step.
  if (assignment.status === "proposed") await conn.reducers.approveOffer({ assignmentId: assignment.id });
  if (conn.db.assignment.id.find(assignment.id)?.status === "offered") await conn.reducers.acceptOffer({ assignmentId: assignment.id });
  await conn.reducers.notifyResident({ requestId: request.id });
  await conn.reducers.simulateResidentDelivery({ requestId: request.id });
  await evidence("4 simulated acceptance and notice", { requestId: request.id, status: conn.db.request.id.find(request.id)?.status,
    messages: [...conn.db.message.iter()].filter(m => m.householdId === home.id).map(m => ({ id: m.id, state: m.state, providerId: m.providerId })) });
  for (let i = 0; i < 300; i++) {
    const r = conn.db.dispatchRoute.assignmentId.find(assignment.id);
    if (r?.state === "ready" || (r?.state === "failed" && !r.failureReason?.startsWith("Routing provider"))) break;
    await sleep(100);
  }
  const route = conn.db.dispatchRoute.assignmentId.find(assignment.id)!;
  await evidence("5 real road geometry", { assignmentId: assignment.id, state: route?.state, source: route?.source, points: route?.points.length,
    distanceMeters: route?.distanceMeters, durationSeconds: route?.durationSeconds, failureReason: route?.failureReason });
  assert.equal(route?.state, "ready", "Road routing must succeed; start the route-only bridge or inspect provider/closure failure");
  assert(route.points.length > 2);
  if (stage === "routed") return home.id;
  await conn.reducers.closeRequest({ requestId: request.id });
  assert.equal(conn.db.request.id.find(request.id)?.status, "closed");
  assert.equal(conn.db.assignment.id.find(assignment.id)?.status, "completed");
  await evidence("6 rescue closed and resource released", { requestId: request.id, assignment: "completed", routeInvalidated: conn.db.dispatchRoute.assignmentId.find(assignment.id)?.state, coverage: conn.db.coverage.id.find(0) });
  await conn.reducers.simulateFollowUp({ householdId: home.id });
  const follow = conn.db.followUp.householdId.find(home.id)!;
  assert(follow.simulated && follow.questions.length >= 9);
  await evidence("7 after-event comparison", { householdId: home.id, state: follow.state, questions: follow.questions.length,
    changes: JSON.parse(follow.changesJson), insuranceSelf: follow.insuranceSelf, insuranceVehicle: follow.insuranceVehicle, insuranceProperty: follow.insuranceProperty ?? "unknown", realSends: 0 });
  return home.id;
}
