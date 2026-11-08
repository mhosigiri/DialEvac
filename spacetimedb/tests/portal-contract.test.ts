import { describe, expect, it } from "vitest";
import { Timestamp } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { seedAssistanceStory } from "../src/demos";
import { buildWorld } from "../src/dispatch";
import { buildCases } from "../../dispatchers-portal/src/lib/cases";

type Context = Parameters<typeof moduleExports.closeRequest>[0];
function fixture() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  h.clock.set(Timestamp.fromDate(new Date("2026-11-08T03:25:00Z")));
  const tx = <T>(body: (ctx: Context) => T) => h.withReducerTx(TestAuth.internal(), body);
  tx(seedAssistanceStory);
  const a = tx(ctx => [...ctx.db.assignment.iter()][0]);
  return { h, tx, a };
}

describe("closed requests terminate dispatcher work", () => {
  it("rejects proposePlan for a closed request and rolls the whole write back", () => {
    const { tx, a } = fixture();
    tx(ctx => {
      ctx.db.assignment.id.delete(a.id);
      moduleExports.closeRequest(ctx, { requestId: a.requestId });
    });
    const plansBefore = tx(ctx => ctx.db.plan.count());
    expect(() => tx(ctx => moduleExports.proposePlan(ctx, { solver: "portal", offers: [{ requestId: a.requestId, vehicleId: a.vehicleId,
      shelterId: undefined, etaMinutes: 6, stopOrder: 2 }], replace: [], revoke: [] }))).toThrow(/closed/);
    tx(ctx => {
      expect(ctx.db.assignment.count()).toBe(0n);
      expect(ctx.db.plan.count()).toBe(plansBefore);
    });
  });

  it("completes accepted assignments, clears ETA and releases the vehicle on Mark rescued", () => {
    const { tx, a } = fixture();
    tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: a.id }));
    tx(ctx => moduleExports.acceptOffer(ctx, { assignmentId: a.id }));
    tx(ctx => moduleExports.closeRequest(ctx, { requestId: a.requestId }));
    tx(ctx => {
      expect(ctx.db.assignment.id.find(a.id)?.status).toBe("completed");
      expect(ctx.db.request.id.find(a.requestId)).toMatchObject({ status: "closed", etaMinutes: undefined });
      expect(buildWorld(ctx).vehicleIds).toContain(a.vehicleId);
      expect([...ctx.db.callback.iter()].every(cb => cb.state !== "pending")).toBe(true);
      expect([...ctx.db.message.iter()].filter(m => m.requestStatus !== undefined && m.direction === "out").every(m => m.state !== "queued")).toBe(true);
    });
  });

  it.each(["proposed", "offered"])("ends %s offers on closure and rejects a stale approval/driver response", status => {
    const { tx, a } = fixture();
    if (status === "offered") tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: a.id }));
    tx(ctx => moduleExports.closeRequest(ctx, { requestId: a.requestId }));
    tx(ctx => expect(ctx.db.assignment.id.find(a.id)?.status).toBe("replaced"));
    expect(() => tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: a.id }))).toThrow(/changed|closed/);
    expect(() => tx(ctx => moduleExports.acceptOffer(ctx, { assignmentId: a.id }))).toThrow(/changed|closed/);
  });

  it("idempotently repairs legacy accepted assignments left on a closed request", () => {
    const { tx, a } = fixture();
    tx(ctx => {
      const r = ctx.db.request.id.find(a.requestId)!;
      ctx.db.request.id.update({ ...r, status: "closed", etaMinutes: 5 });
      ctx.db.assignment.id.update({ ...a, status: "accepted" });
    });
    tx(ctx => moduleExports.closeRequest(ctx, { requestId: a.requestId }));
    tx(ctx => moduleExports.closeRequest(ctx, { requestId: a.requestId }));
    tx(ctx => {
      expect(ctx.db.assignment.id.find(a.id)?.status).toBe("completed");
      expect(ctx.db.request.id.find(a.requestId)?.etaMinutes).toBeUndefined();
      expect(ctx.db.callback.count()).toBe(0n);
    });
  });

  it.each(["approveOffer", "declineOffer", "cancelByDriver"] as const)("rejects %s on a legacy live assignment attached to a closed request", name => {
    const { tx, a } = fixture();
    tx(ctx => {
      const r = ctx.db.request.id.find(a.requestId)!;
      ctx.db.request.id.update({ ...r, status: "closed" });
      ctx.db.assignment.id.update({ ...a, status: name === "approveOffer" ? "proposed" : name === "declineOffer" ? "offered" : "accepted" });
    });
    expect(() => tx(ctx => moduleExports[name](ctx, { assignmentId: a.id, reason: "test" }))).toThrow(/closed|changed/);
  });

  it("rejects escalation of a closed request", () => {
    const { tx, a } = fixture();
    tx(ctx => moduleExports.closeRequest(ctx, { requestId: a.requestId }));
    const homeId = tx(ctx => ctx.db.request.id.find(a.requestId)!.householdId);
    expect(() => tx(ctx => moduleExports.escalate(ctx, { householdId: homeId, reason: "medical" }))).toThrow(/closed/);
  });

  it("rejects a callback claim after closure so a queued worker cannot announce an obsolete ride", () => {
    const { tx, a } = fixture();
    tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: a.id }));
    tx(ctx => moduleExports.acceptOffer(ctx, { assignmentId: a.id }));
    const callbackId = tx(ctx => [...ctx.db.callback.iter()][0].id);
    tx(ctx => moduleExports.closeRequest(ctx, { requestId: a.requestId }));
    expect(() => tx(ctx => moduleExports.markCallback(ctx, { callbackId, state: "placed" }))).toThrow(/changed|closed/);
  });

  it("commits the portal's appended stop against a vehicle with an accepted run", () => {
    const { tx, a } = fixture();
    tx(ctx => moduleExports.approveOffer(ctx, { assignmentId: a.id }));
    tx(ctx => moduleExports.acceptOffer(ctx, { assignmentId: a.id }));
    tx(ctx => {
      const other = [...ctx.db.household.iter()].find(h => h.id !== ctx.db.request.id.find(a.requestId)!.householdId)!;
      const source = ctx.db.request.id.find(a.requestId)!;
      const pending = ctx.db.request.insert({ ...source, id: 0n, householdId: other.id, status: "received", etaMinutes: undefined });
      const row = buildCases({ households: [...ctx.db.household.iter()], requests: [...ctx.db.request.iter()],
        assignments: [...ctx.db.assignment.iter()], vehicles: [ctx.db.vehicle.id.find(a.vehicleId)!], calls: [...ctx.db.call.iter()] }).find(c => c.request?.id === pending.id)!;
      expect(row.action.kind).toBe("dispatch");
      if (row.action.kind !== "dispatch") throw new Error("missing dispatch");
      moduleExports.proposePlan(ctx, { solver: "portal", offers: [{ ...row.action, shelterId: undefined }], replace: [], revoke: [] });
      expect([...ctx.db.assignment.requestId.filter(pending.id)][0].stopOrder).toBeGreaterThan(a.stopOrder);
    });
  });
});
