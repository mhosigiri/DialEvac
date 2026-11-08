import { describe, expect, it } from "vitest";
import { ConnectionId } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedAssistanceStory } from "../src/demos";
import { control } from "../src/core";

type Context = Parameters<typeof moduleExports.closeRequest>[0];
type Grants = { OPERATOR_IDENTITIES?: string; SERVICE_IDENTITIES?: string; DEMO_MODE?: string; DEMO_PUBLIC_DISPATCH?: string };
function environment(ctx: Context, grants: Grants): Context {
  return new Proxy(ctx, { get: (target, key) => key === "env" ? grants : Reflect.get(target, key, target) });
}
const operatorActions = ["proposePlan", "approveOffer", "acceptOffer", "declineOffer", "cancelByDriver", "importRiders", "setZone", "escalate", "closeRequest", "closeRoad", "reopenRoad", "issueWarning", "setStandIns", "setHazardOrigin", "endNight", "startFeeds", "notifyResident", "requestDispatchRoute", "retryCallAnalysis", "seedHistoricalHoustonDemo", "prepareHoustonDemo", "simulateCatastrophe", "simulateAssessment", "matchClosestDispatcher", "simulateFollowUp", "simulateResidentDelivery", "normalizeFixtureLabels"] as const;
const serviceActions = ["claimCall", "callAnswered", "callEnded", "addTranscriptLine", "markCallback", "recordDigit", "inboundCallEnded", "claimMessage", "messageSent", "messageFailed", "messageWaiting", "receiveMessage", "recordCallTranscript", "recordCallAssessment", "reportCallHandoff", "recordDispatchRoute", "recordProviderCall", "claimCallAnalysis", "finishCallAnalysis", "startDemoOutboundAttempt", "recordRouteGuidance"] as const;
const schedules = ["expireOffer", "runReachStep", "tick", "expireDispatchRoute"] as const;

function fixture() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  const op = TestAuth.fromJwtPayload(JSON.stringify({ iss: "test", sub: "operator" }), new ConnectionId(1n));
  const service = TestAuth.fromJwtPayload(JSON.stringify({ iss: "test", sub: "service" }), new ConnectionId(2n));
  const stranger = TestAuth.fromJwtPayload(JSON.stringify({ iss: "test", sub: "viewer", role: "operator" }), new ConnectionId(3n));
  const opId = h.withReducerTx(op, ctx => ctx.sender.toHexString());
  const serviceId = h.withReducerTx(service, ctx => ctx.sender.toHexString());
  const grants = { OPERATOR_IDENTITIES: opId, SERVICE_IDENTITIES: serviceId, DEMO_MODE: "isolated" };
  const call = (auth: typeof op, name: typeof operatorActions[number] | typeof serviceActions[number] | typeof schedules[number] | "updateRecord", args = {}, settings: Grants = grants) =>
    h.withReducerTx(auth, ctx => (moduleExports[name] as (ctx: Context, args: object) => unknown)(environment(ctx, settings), args));
  h.withReducerTx(TestAuth.internal(), ctx => control(ctx));
  return { h, op, service, stranger, grants, call };
}

describe("reducer role boundaries", () => {
  it("classifies every exported entry point so additions require an explicit policy decision", () => {
    expect(Object.keys(moduleExports).sort()).toEqual([...operatorActions, ...serviceActions, ...schedules, "updateRecord", "default", "init", "replan", "pollFeeds", "calculateDispatchRoute",
      "seedStandInTown", "seedTornadoDemo", "replayWarning", "seedAssistanceDemo", "advanceAssistanceDemo", "seedHoustonVoiceDemo"].sort());
  });
  it.each([...operatorActions, ...serviceActions, "updateRecord"] as const)("denies an ungranted viewer at %s before any data validation or write", name => {
    const { call, stranger, h } = fixture();
    expect(() => call(stranger, name)).toThrow(/Not authorized/);
    expect(h.db.household.count()).toBe(0n);
    expect(h.db.auditLog.count()).toBe(0n);
  });

  it.each(serviceActions)("keeps service-only %s unavailable to operators", name => {
    const { call, op } = fixture();
    expect(() => call(op, name)).toThrow(/Not authorized/);
  });

  it.each(operatorActions)("keeps operator-only %s unavailable to services", name => {
    const { call, service } = fixture();
    expect(() => call(service, name)).toThrow(/Not authorized/);
  });

  it("fails closed with missing, malformed, or merely claimed roles, including on the demo database", () => {
    const { call, op } = fixture();
    for (const settings of [{}, { OPERATOR_IDENTITIES: "operator" }, { OPERATOR_IDENTITIES: "", DEMO_MODE: "isolated" }]) {
      expect(() => call(op, "startFeeds", {}, settings)).toThrow(/Not authorized/);
    }
  });

  it("allows a granted operator and recognizes an explicitly listed stable identity", () => {
    const { call, op, grants, h } = fixture();
    call(op, "startFeeds", {}, { OPERATOR_IDENTITIES: ` , 0x${grants.OPERATOR_IDENTITIES.toUpperCase()}, ` });
    expect(h.db.feedPoll.count()).toBe(1n);
  });

  it("allows fresh browser identities to dispatch only with explicit isolated-demo opt-in", () => {
    const { h, stranger, service, call } = fixture();
    h.withReducerTx(TestAuth.internal(), seedAssistanceStory);
    const home = [...h.db.household.iter()][0];
    const settings = { DEMO_MODE: "isolated", DEMO_PUBLIC_DISPATCH: "true" };
    const args = { householdId: home.id, source: "browser-demo", patch: { canLeave: undefined, people: 3, mobility: undefined, assistance: undefined, oxygen: undefined } };
    call(stranger, "updateRecord", args, settings);
    call(service, "updateRecord", args, settings);
    expect(h.db.household.id.find(home.id)?.people).toBe(3);
    expect(() => call(stranger, "claimCall", {}, settings)).toThrow(/Not authorized/);
    for (const env of [{ DEMO_PUBLIC_DISPATCH: "true" }, { DEMO_MODE: "operational", DEMO_PUBLIC_DISPATCH: "true" }, { DEMO_MODE: "isolated", DEMO_PUBLIC_DISPATCH: "false" }]) {
      expect(() => call(stranger, "updateRecord", args, env)).toThrow(/Not authorized/);
    }
    h.withReducerTx(TestAuth.internal(), ctx => ctx.db.household.id.update({ ...ctx.db.household.id.find(home.id)!, simulated: false }));
    expect(() => call(stranger, "updateRecord", args, settings)).toThrow(/Not authorized/);
  });

  it("allows service writes and shared record updates, then immediately respects revocation", () => {
    const { call, service, op, h } = fixture();
    h.withReducerTx(TestAuth.internal(), seedAssistanceStory);
    const home = [...h.db.household.iter()][0];
    call(service, "inboundCallEnded", { phone: home.phone, providerId: "conv-auth", choice: "2", people: undefined, oxygen: undefined });
    expect([...h.db.call.iter()].some(c => c.providerId === "conv-auth")).toBe(true);
    const patch = { canLeave: undefined, people: 3, mobility: undefined, assistance: undefined, oxygen: undefined };
    call(service, "updateRecord", { householdId: home.id, patch, source: "voice" });
    call(op, "updateRecord", { householdId: home.id, patch, source: "operator" });
    expect(h.db.household.id.find(home.id)?.people).toBe(3);
    expect(() => call(service, "callEnded", { callId: 999n, outcome: "answered" }, {})).toThrow(/Not authorized/);
  });

  it.each(schedules)("does not let any client forge scheduled %s work", name => {
    const { call, op, service, stranger } = fixture();
    for (const caller of [op, service, stranger]) expect(() => call(caller, name)).toThrow(/scheduled|internal/i);
  });

  it.each(["replan", "pollFeeds", "calculateDispatchRoute"] as const)("rejects client calls to scheduled %s before issuing any HTTP request", name => {
    const { h, op, service, stranger } = fixture();
    for (const auth of [op, service, stranger]) {
      const ctx = h.procedureContextBuilder(auth).http(() => { throw new Error("HTTP must not run"); }).build();
      expect(() => moduleExports[name](ctx, {} as never)).toThrow(/scheduled|internal/);
    }
  });
});
