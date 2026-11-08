import { describe, expect, it } from "vitest";
import { TimeDuration, Timestamp } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { control, type Tx } from "../src/core";
import { applyRecord, applyZone, handleDigit, handleInboundCall, handleReply, insertHousehold } from "../src/households";
import { writePlan } from "../src/plans";
import { accept } from "../src/offers";
import { buildWorld, commit, solve } from "../src/dispatch";
import { applyZones, parseAlerts } from "../src/feeds";
import { upsertClosure } from "../src/roads";

// Each describe block is one rule a promise to a resident depends on.

const ORIGIN = { lat: 32.9857, lng: -96.7502 };
const ZONE: [number, number][][] = [[[-96.8, 32.95], [-96.7, 32.95], [-96.7, 33.02], [-96.8, 33.02], [-96.8, 32.95]]];

function harness() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  h.clock.set(Timestamp.fromDate(new Date("2026-11-08T03:25:00Z")));
  const tx = <T>(body: (ctx: Tx) => T) => h.withReducerTx(TestAuth.internal(), body);
  return { h, tx };
}

function town(tx: Tx) {
  const c = control(tx);
  tx.db.control.id.update({ ...c, autoApprove: true, warningAt: tx.timestamp });
  const home = insertHousehold(tx, {
    riderId: "carmen",
    name: "Carmen",
    address: "100 Terrace St",
    lat: ORIGIN.lat + 0.005,
    lng: ORIGIN.lng,
    phone: "+12145550100",
    language: "es",
    mobility: "walks",
    assistance: "none",
    simulated: false,
  });
  const lift = tx.db.vehicle.insert({ id: 0n, name: "Van 1", driverName: "Maria", kind: "wheelchair-accessible van", seats: 4, wheelchairSpaces: 1, stretcherSpaces: 0, crew: 2, lift: true, lat: ORIGIN.lat - 0.01, lng: ORIGIN.lng, simulated: false });
  const bus = tx.db.vehicle.insert({ id: 0n, name: "Bus 1", driverName: "Sam", kind: "bus", seats: 20, wheelchairSpaces: 0, stretcherSpaces: 0, crew: 1, lift: false, lat: ORIGIN.lat - 0.01, lng: ORIGIN.lng + 0.01, simulated: false });
  tx.db.shelter.insert({ id: 0n, name: "Shelter", lat: ORIGIN.lat - 0.02, lng: ORIGIN.lng, capacity: 100 });
  applyZone(tx, ZONE);
  const reached = applyRecord(tx, tx.db.household.id.find(home.id)!, { canLeave: false, mobility: "wheelchair", assistance: "two_person_lift" }, "voice");
  const request = tx.db.request.householdId.find(reached.id)!;
  return { home: reached, request, lift, bus };
}

function offer(tx: Tx, requestId: bigint, vehicleId: bigint, stopOrder = 1) {
  writePlan(tx, { solver: "test", solveMs: 0, offers: [{ requestId, vehicleId, etaMinutes: 6, stopOrder }], replace: [], revoke: [], escalate: [] });
  return [...tx.db.assignment.requestId.filter(requestId)].find((a) => a.status === "offered")!;
}

describe("a household that can't leave gets one ride request", () => {
  it("opens it on the record, in the zone", () => {
    const { tx } = harness();
    const { request } = tx(town);
    expect(request.status).toBe("received");
    expect(request.mobility).toBe("wheelchair");
  });
});

describe("compatibility", () => {
  it("refuses an offer to a vehicle without the space, crew or lift", () => {
    const { tx } = harness();
    const { request, bus } = tx(town);
    expect(() => tx((ctx) => offer(ctx, request.id, bus.id))).toThrow(/can't serve/);
    tx((ctx) => expect([...ctx.db.assignment.iter()]).toHaveLength(0));
  });
});

describe("approval is not a promise; acceptance is", () => {
  it("calls the rider only once a driver accepts, with the template", () => {
    const { tx } = harness();
    const { request, lift } = tx(town);
    const a = tx((ctx) => offer(ctx, request.id, lift.id));
    tx((ctx) => {
      expect(ctx.db.request.id.find(request.id)!.status).toBe("approved");
      expect(ctx.db.callback.count()).toBe(0n);
    });
    tx((ctx) => accept(ctx, a.id));
    tx((ctx) => {
      expect(ctx.db.request.id.find(request.id)!.status).toBe("driver_accepted");
      const [cb] = [...ctx.db.callback.iter()];
      expect(cb.line).toContain("The driver's name is Maria");
      expect([...ctx.db.message.iter()].some((m) => m.body === cb.line && m.state === "queued")).toBe(true);
    });
  });

  it("rejects a second accept of the same offer as changed, writing nothing", () => {
    const { tx } = harness();
    const { request, lift } = tx(town);
    const a = tx((ctx) => offer(ctx, request.id, lift.id));
    tx((ctx) => accept(ctx, a.id));
    expect(() => tx((ctx) => accept(ctx, a.id))).toThrow("changed");
    tx((ctx) => expect(ctx.db.callback.count()).toBe(1n));
  });
});

describe("accepted runs are frozen", () => {
  it("refuses a new offer inside a vehicle's accepted run", () => {
    const { tx } = harness();
    const { request, lift } = tx(town);
    const a = tx((ctx) => offer(ctx, request.id, lift.id, 3));
    tx((ctx) => accept(ctx, a.id));
    const second = tx((ctx) => {
      const home = insertHousehold(ctx, { riderId: "walter", name: "Walter", address: "102 Terrace St", lat: ORIGIN.lat + 0.006, lng: ORIGIN.lng, phone: "+12145550101", language: "en", mobility: "walks", assistance: "none", simulated: false });
      applyZone(ctx, ZONE);
      return ctx.db.request.householdId.find(applyRecord(ctx, ctx.db.household.id.find(home.id)!, { canLeave: false }, "voice").id)!;
    });
    expect(() => tx((ctx) => offer(ctx, second.id, lift.id, 2))).toThrow(/accepted run/);
    expect(() => tx((ctx) => offer(ctx, second.id, lift.id, 4))).not.toThrow();
  });
});

describe("corrections reach offers", () => {
  it("revokes an accepted pickup the vehicle can no longer serve, and tells the rider", () => {
    const { tx } = harness();
    const { home, request, lift } = tx(town);
    const a = tx((ctx) => offer(ctx, request.id, lift.id));
    tx((ctx) => accept(ctx, a.id));
    tx((ctx) => applyRecord(ctx, ctx.db.household.id.find(home.id)!, { mobility: "bedbound" }, "voice"));
    tx((ctx) => {
      expect(ctx.db.assignment.id.find(a.id)!.status).toBe("revoked");
      expect(ctx.db.request.id.find(request.id)!.status).toBe("reassigning");
      expect([...ctx.db.callback.iter()].map((c) => c.status)).toEqual(["driver_accepted", "reassigning"]);
      expect([...ctx.db.correction.iter()].map((c) => c.field)).toContain("mobility");
    });
  });

  it("ends an open offer silently", () => {
    const { tx } = harness();
    const { home, request, lift } = tx(town);
    tx((ctx) => offer(ctx, request.id, lift.id));
    tx((ctx) => applyRecord(ctx, ctx.db.household.id.find(home.id)!, { mobility: "bedbound" }, "voice"));
    tx((ctx) => {
      expect(ctx.db.request.id.find(request.id)!.status).toBe("received");
      expect(ctx.db.callback.count()).toBe(0n);
    });
  });
});

describe("the dispatcher", () => {
  it("plans with the fallback heuristic when no solver is configured", () => {
    const { tx } = harness();
    const { request, lift } = tx(town);
    const world = tx(buildWorld);
    const noHttp = { fetch: () => { throw new Error("no network in tests"); } };
    const { solution, fallbackReason } = solve(world.problem, noHttp, undefined, undefined);
    expect(fallbackReason).toBe("no solver service configured");
    tx((ctx) => commit(ctx, world, solution, fallbackReason));
    tx((ctx) => {
      const [a] = [...ctx.db.assignment.requestId.filter(request.id)];
      expect(a.vehicleId).toBe(lift.id);
      expect(a.status).toBe("offered");
    });
  });

  it("falls back when the solver fails, and revokes a pickup a closure cuts off", () => {
    const { h, tx } = harness();
    const { request, lift, home } = tx(town);
    const failing = { fetch: () => ({ ok: false, status: 503, json: () => null }) };
    const world = tx(buildWorld);
    const { solution, fallbackReason } = solve(world.problem, failing, "http://solver.test", "token");
    expect(fallbackReason).toBe("solver answered 503");
    tx((ctx) => commit(ctx, world, solution, fallbackReason));
    const a = tx((ctx) => [...ctx.db.assignment.requestId.filter(request.id)][0]);
    tx((ctx) => accept(ctx, a.id));
    h.clock.advance(TimeDuration.fromMillis(1000));
    tx((ctx) => {
      const v = ctx.db.vehicle.id.find(lift.id)!;
      upsertClosure(ctx, { externalId: "manual-1", source: "manual", street: "Terrace St", lat: (v.lat + home.lat) / 2, lng: (v.lng + home.lng) / 2, active: true });
    });
    const next = tx(buildWorld);
    tx((ctx) => commit(ctx, next, { routes: [], dropped: [], solver: "heuristic", solveMs: 0 }));
    tx((ctx) => {
      expect(ctx.db.assignment.id.find(a.id)!.status).toBe("revoked");
      expect(ctx.db.request.id.find(request.id)!.status).toBe("reassigning");
    });
  });
});

describe("Photon replies", () => {
  it("fills the record from a numbered reply and answers with the status line", () => {
    const { h } = harness();
    const tx = <T>(body: (ctx: Tx) => T) => h.withReducerTx(TestAuth.internal(), body);
    const home = tx((ctx) => {
      ctx.db.control.id.update({ ...control(ctx), warningAt: ctx.timestamp });
      const row = insertHousehold(ctx, { riderId: "r1", name: "Ana", address: "1 Elm St", lat: ORIGIN.lat, lng: ORIGIN.lng, phone: "+12145550199", language: "en", mobility: "walks", assistance: "none", simulated: false });
      applyZone(ctx, ZONE);
      return row;
    });
    tx((ctx) => handleReply(ctx, "+12145550199", "3", "photon-1"));
    tx((ctx) => {
      const request = ctx.db.request.householdId.find(home.id)!;
      expect(request.mobility).toBe("wheelchair");
      const outbound = [...ctx.db.message.iter()].filter((m) => m.direction === "out");
      expect(outbound.at(-1)!.body).toContain("No driver has accepted yet");
    });
    tx((ctx) => expect(ctx.db.request.householdId.find(home.id)!.status).toBe("received"));
  });
});

describe("the NWS feed", () => {
  it("puts homes inside a severe alert polygon into the warning zone", () => {
    const { tx } = harness();
    tx((ctx) => insertHousehold(ctx, { riderId: "r2", name: "Bo", address: "2 Elm St", lat: ORIGIN.lat, lng: ORIGIN.lng, phone: "+12145550198", language: "en", mobility: "walks", assistance: "none", simulated: false }));
    const zones = parseAlerts({
      features: [
        { id: "urn:alert:1", geometry: { type: "Polygon", coordinates: ZONE }, properties: { event: "Tornado Warning", severity: "Extreme", areaDesc: "Dallas, TX" } },
        { id: "urn:alert:2", geometry: null, properties: { event: "Heat Advisory", severity: "Moderate", areaDesc: "Collin, TX" } },
      ],
    });
    expect(zones).toHaveLength(1);
    tx((ctx) => applyZones(ctx, zones));
    tx((ctx) => {
      expect([...ctx.db.household.iter()][0].inZone).toBe(true);
      expect(ctx.db.zone.count()).toBe(1n);
    });
    tx((ctx) => applyZones(ctx, []));
    tx((ctx) => expect([...ctx.db.zone.iter()][0].active).toBe(false));
  });
});

describe("keypad answers on a survey call", () => {
  it("fill the record the same way a Photon reply does", () => {
    const { tx } = harness();
    const callId = tx((ctx) => {
      ctx.db.control.id.update({ ...control(ctx), warningAt: ctx.timestamp });
      const home = insertHousehold(ctx, { riderId: "r3", name: "Cy", address: "3 Elm St", lat: ORIGIN.lat, lng: ORIGIN.lng, phone: "+12145550197", language: "en", mobility: "walks", assistance: "none", simulated: false });
      applyZone(ctx, ZONE);
      return ctx.db.call.insert({ id: 0n, householdId: home.id, purpose: "survey", phase: "live", attempt: 1, priority: 0, outcome: undefined, providerId: undefined, queuedAt: ctx.timestamp, endedAt: undefined }).id;
    });
    expect(tx((ctx) => handleDigit(ctx, callId, "4"))).toBe(true);
    expect(tx((ctx) => handleDigit(ctx, callId, "9"))).toBe(false);
    tx((ctx) => expect([...ctx.db.request.iter()][0].mobility).toBe("bedbound"));
  });
});

describe("a resident who calls the response line", () => {
  it("is matched by phone, logged once, and their answer fills the record", () => {
    const { tx } = harness();
    const homeId = tx((ctx) => {
      ctx.db.control.id.update({ ...control(ctx), warningAt: ctx.timestamp });
      const home = insertHousehold(ctx, { riderId: "r4", name: "Di", address: "4 Elm St", lat: ORIGIN.lat, lng: ORIGIN.lng, phone: "+12145550196", language: "en", mobility: "walks", assistance: "none", simulated: false });
      applyZone(ctx, ZONE);
      return home.id;
    });
    const answer = { choice: "3", people: 2, oxygen: true };
    tx((ctx) => handleInboundCall(ctx, "+12145550196", "conv_1", answer));
    tx((ctx) => handleInboundCall(ctx, "+12145550196", "conv_1", answer));
    tx((ctx) => {
      const home = ctx.db.household.id.find(homeId)!;
      expect([home.reach, home.canLeave, home.mobility, home.people, home.oxygen]).toEqual(["reached", false, "wheelchair", 2, true]);
      expect(ctx.db.request.householdId.find(homeId)!.mobility).toBe("wheelchair");
      const calls = [...ctx.db.call.householdId.filter(homeId)];
      expect(calls.map((c) => [c.purpose, c.phase, c.outcome, c.providerId])).toEqual([["inbound", "ended", "answered", "conv_1"]]);
    });
  });

  it("without a clear answer is logged but leaves the home unreached", () => {
    const { tx } = harness();
    const homeId = tx((ctx) => insertHousehold(ctx, { riderId: "r5", name: "Ed", address: "5 Elm St", lat: ORIGIN.lat, lng: ORIGIN.lng, phone: "+12145550195", language: "en", mobility: "walks", assistance: "none", simulated: false }).id);
    tx((ctx) => handleInboundCall(ctx, "+12145550195", "conv_2", { choice: "", people: 4 }));
    tx((ctx) => {
      const home = ctx.db.household.id.find(homeId)!;
      expect(home.reach).not.toBe("reached");
      expect(home.people).not.toBe(4);
      expect(ctx.db.call.count()).toBe(1n);
    });
  });

  it("from an unknown number is audited, not attached to anyone", () => {
    const { tx } = harness();
    expect(tx((ctx) => handleInboundCall(ctx, "+12145550000", "conv_3", { choice: "1" }))).toBeUndefined();
    tx((ctx) => {
      expect(ctx.db.call.count()).toBe(0n);
      expect([...ctx.db.auditLog.iter()].at(-1)!.message).toContain("unknown number ending 0000");
    });
  });
});
