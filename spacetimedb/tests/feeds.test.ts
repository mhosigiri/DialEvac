import { describe, expect, it } from "vitest";
import { Timestamp } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { type Tx } from "../src/core";
import { insertHousehold } from "../src/households";
import { applyZones, commitFeed, parseAlerts, parseNwsResponse, replayPhase } from "../src/feeds";

const ORIGIN = { lat: 32.9857, lng: -96.7502 };
const POLY: [number, number][][] = [[[-96.8, 32.95], [-96.7, 32.95], [-96.7, 33.02], [-96.8, 33.02], [-96.8, 32.95]]];
const POLY2: [number, number][][] = [[[-96.81, 32.96], [-96.71, 32.96], [-96.71, 33.01], [-96.81, 33.01], [-96.81, 32.96]]];
const MULTI: [number, number][][][] = [POLY, [[[-96.6, 32.9], [-96.55, 32.9], [-96.55, 32.95], [-96.6, 32.95], [-96.6, 32.9]]]];

function harness() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  h.clock.set(Timestamp.fromDate(new Date("2026-11-08T03:25:00Z")));
  const tx = <T>(body: (ctx: Tx) => T) => h.withReducerTx(TestAuth.internal(), body);
  return { h, tx };
}

function tornado(id: string, extra: Record<string, unknown> = {}, geometry: unknown = { type: "Polygon", coordinates: POLY }) {
  return {
    id,
    geometry,
    properties: {
      event: "Tornado Warning",
      severity: "Extreme",
      areaDesc: "Dallas, TX",
      headline: "Tornado Warning for Dallas",
      sent: "2026-11-08T03:20:00Z",
      expires: "2026-11-08T04:00:00Z",
      messageType: "Alert",
      status: "Actual",
      web: "https://api.weather.gov/alerts/" + id,
      ...extra,
    },
  };
}

function outreach(tx: Tx) {
  return {
    inZone: [...tx.db.household.iter()].filter((h) => h.inZone).length,
    requests: Number(tx.db.request.count()),
    calls: Number(tx.db.call.count()),
    assignments: Number(tx.db.assignment.count()),
    callbacks: Number(tx.db.callback.count()),
  };
}

describe("NWS tornado parsing", () => {
  it("keeps tornado warnings with holes, multipart geometry, or no geometry, and drops other events", () => {
    const { zones, malformed } = parseNwsResponse({
      features: [
        tornado("urn:poly"),
        tornado("urn:multi", {}, { type: "MultiPolygon", coordinates: MULTI }),
        tornado("urn:nogeom", {}, null),
        tornado("urn:heat", { event: "Heat Advisory" }),
        tornado("urn:test", { status: "Test" }),
      ],
    });
    expect(malformed).toBeUndefined();
    expect(zones.map((z) => z.externalId).sort()).toEqual(["urn:multi", "urn:nogeom", "urn:poly"]);
    expect(zones.find((z) => z.externalId === "urn:multi")!.geometryJson).toContain("MultiPolygon");
    expect(zones.find((z) => z.externalId === "urn:nogeom")!.geometryJson).toBe("");
    expect(parseAlerts({ ok: false })).toEqual([]);
    expect(parseNwsResponse({ ok: false }).malformed).toMatch(/unknown shape/);
  });
});

describe("feed reconciliation", () => {
  it("upserts duplicates, revisions, cancellations, expiry, and missing geometry without outreach", () => {
    const { tx } = harness();
    tx((ctx) =>
      insertHousehold(ctx, {
        riderId: "r2",
        name: "Bo",
        address: "2 Elm St",
        lat: ORIGIN.lat,
        lng: ORIGIN.lng,
        phone: "+12145550198",
        language: "en",
        mobility: "walks",
        assistance: "none",
        simulated: false,
      }),
    );

    const first = parseAlerts({ features: [tornado("urn:alert:1")] });
    tx((ctx) => commitFeed(ctx, { area: "TX", zones: first }));
    tx((ctx) => commitFeed(ctx, { area: "TX", zones: first }));
    tx((ctx) => {
      expect(ctx.db.zone.count()).toBe(1n);
      expect(ctx.db.zone.externalId.find("urn:alert:1")!.headline).toBe("Tornado Warning for Dallas");
      expect(ctx.db.feedHealth.id.find(0)!.stale).toBe(false);
      expect(ctx.db.feedHealth.id.find(0)!.warningCount).toBe(1);
      expect(outreach(ctx)).toEqual({ inZone: 0, requests: 0, calls: 0, assignments: 0, callbacks: 0 });
    });

    const revised = parseAlerts({
      features: [tornado("urn:alert:1", { headline: "Updated tornado warning", messageType: "Update" }, { type: "Polygon", coordinates: POLY2 })],
    });
    tx((ctx) => commitFeed(ctx, { area: "TX", zones: revised }));
    tx((ctx) => {
      const row = ctx.db.zone.externalId.find("urn:alert:1")!;
      expect(row.headline).toBe("Updated tornado warning");
      expect(row.messageType).toBe("Update");
      expect(row.active).toBe(true);
      expect(row.rings).toBe(JSON.stringify(POLY2));
      expect(ctx.db.zone.count()).toBe(1n);
    });

    tx((ctx) => commitFeed(ctx, { area: "TX", zones: parseAlerts({ features: [tornado("urn:alert:1", { messageType: "Cancel" })] }) }));
    tx((ctx) => {
      expect(ctx.db.zone.externalId.find("urn:alert:1")!.active).toBe(false);
      expect(ctx.db.zone.externalId.find("urn:alert:1")!.headline).toBe("Updated tornado warning");
      expect(ctx.db.zone.count()).toBe(1n);
    });

    tx((ctx) => commitFeed(ctx, { area: "TX", zones: parseAlerts({ features: [tornado("urn:nogeom", {}, null)] }) }));
    tx((ctx) => {
      const row = ctx.db.zone.externalId.find("urn:nogeom")!;
      expect(row.active).toBe(true);
      expect(row.geometryJson ?? "").toBe("");
      expect(row.rings).toBe("");
      expect(outreach(ctx)).toEqual({ inZone: 0, requests: 0, calls: 0, assignments: 0, callbacks: 0 });
    });

    tx((ctx) =>
      commitFeed(ctx, {
        area: "TX",
        zones: parseAlerts({ features: [tornado("urn:expired", { expires: "2026-11-08T03:00:00Z" })] }),
      }),
    );
    tx((ctx) => expect(ctx.db.zone.externalId.find("urn:expired")!.active).toBe(false));
  });

  it("preserves prior live warnings and marks the feed stale on fetch failure", () => {
    const { tx } = harness();
    tx((ctx) => commitFeed(ctx, { area: "TX", zones: parseAlerts({ features: [tornado("urn:keep")] }) }));
    tx((ctx) => commitFeed(ctx, { area: "TX", failure: "NWS answered 503" }));
    tx((ctx) => {
      const health = ctx.db.feedHealth.id.find(0)!;
      expect(health.stale).toBe(true);
      expect(health.error).toBe("NWS answered 503");
      expect(ctx.db.zone.externalId.find("urn:keep")!.active).toBe(true);
      expect(outreach(ctx)).toEqual({ inZone: 0, requests: 0, calls: 0, assignments: 0, callbacks: 0 });
    });
    tx((ctx) => commitFeed(ctx, { area: "TX", failure: "NWS answered an unknown shape" }));
    tx((ctx) => expect(ctx.db.zone.externalId.find("urn:keep")!.active).toBe(true));
  });

  it("does not deactivate simulated or replay polygons when the live feed is empty", () => {
    const { tx } = harness();
    tx((ctx) => {
      applyZones(ctx, [
        {
          externalId: "sim-tornado",
          name: "Simulated",
          event: "Tornado Warning",
          severity: "Extreme",
          rings: POLY,
          geometryJson: JSON.stringify({ type: "Polygon", coordinates: POLY }),
          headline: "sim",
          url: "",
          messageType: "Alert",
          area: "TX",
          kind: "simulated",
        },
      ], "stand-in", "TX");
      ctx.db.zone.insert({
        id: 0n,
        externalId: "legacy-stand-in",
        source: "stand-in",
        name: "Legacy demo zone",
        event: "Tornado Warning",
        severity: "Extreme",
        rings: JSON.stringify(POLY),
        active: true,
        at: ctx.timestamp,
        headline: undefined,
        issuedAt: undefined,
        expiresAt: undefined,
        url: undefined,
        messageType: undefined,
        kind: undefined,
        geometryJson: undefined,
        area: undefined,
      });
      commitFeed(ctx, { area: "TX", zones: [] });
      expect(ctx.db.zone.externalId.find("sim-tornado")!.active).toBe(true);
      expect(ctx.db.zone.externalId.find("legacy-stand-in")!.active).toBe(true);
    });
  });
});

describe("replay warning", () => {
  it("does not deactivate official live warnings in any replay phase", () => {
    const { tx } = harness();
    tx(ctx => commitFeed(ctx, { area: "TX", zones: parseAlerts({ features: [tornado("urn:live")] }) }));
    for (const phase of ["appear", "update", "disappear"]) {
      tx(ctx => replayPhase(ctx, phase));
      tx(ctx => {
        expect(ctx.db.zone.externalId.find("urn:live")!.active).toBe(true);
        expect(ctx.db.feedHealth.id.find(0)!.warningCount).toBe(1);
      });
    }
    tx(ctx => commitFeed(ctx, { area: "TX", zones: [] }));
    tx(ctx => expect(ctx.db.zone.externalId.find("urn:live")!.active).toBe(false));
  });

  it("appears, updates and clears one replay polygon without counting as live or opening outreach", () => {
    const { tx } = harness();
    const replay = (phase: string) => tx((ctx) => replayPhase(ctx, phase));
    const row = () => tx((ctx) => ctx.db.zone.externalId.find("replay-tornado-dfw"));
    replay("appear");
    const appeared = row()!;
    expect(appeared.active).toBe(true);
    expect(appeared.kind).toBe("replay");
    expect(appeared.messageType).toBe("Alert");
    replay("update");
    const updated = row()!;
    expect(updated.id).toBe(appeared.id);
    expect(updated.messageType).toBe("Update");
    expect(updated.geometryJson).not.toBe(appeared.geometryJson);
    tx((ctx) => commitFeed(ctx, { area: "TX", zones: [] }));
    expect(row()!.active).toBe(true);
    tx((ctx) => expect(ctx.db.feedHealth.id.find(0)!.warningCount).toBe(0));
    replay("disappear");
    expect(row()!.active).toBe(false);
    tx((ctx) => expect(outreach(ctx)).toEqual({ inZone: 0, requests: 0, calls: 0, assignments: 0, callbacks: 0 }));
  });
});
