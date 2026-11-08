import { describe, expect, it } from "vitest";
import { Timestamp } from "spacetimedb";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import * as moduleExports from "../src/index";
import { spacetimedb } from "../src/schema";
import { type Tx } from "../src/core";
import { applyWarnings, parseWarnings, recordPoll } from "../src/feeds";

// The map's warning layer and feed health: what the public map is allowed to say.

function harness() {
  const h = createModuleTestHarness(spacetimedb, moduleExports);
  h.clock.set(Timestamp.fromDate(new Date("2026-11-08T03:25:00Z")));
  const tx = <T>(body: (ctx: Tx) => T) => h.withReducerTx(TestAuth.internal(), body);
  return { h, tx };
}

const POLYGON = { type: "Polygon", coordinates: [[[-96.8, 32.95], [-96.7, 32.95], [-96.7, 33.02], [-96.8, 32.95]]] };
const MULTI = { type: "MultiPolygon", coordinates: [POLYGON.coordinates] };
const URL1 = "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.tor1";

const body = {
  features: [
    {
      id: URL1,
      geometry: POLYGON,
      properties: {
        "@id": URL1,
        id: "urn:oid:2.49.0.1.840.0.tor1",
        event: "Tornado Warning",
        headline: "Tornado Warning issued November 7 at 9:20PM CST until 10:00PM CST by NWS Fort Worth TX",
        areaDesc: "Dallas, TX; Collin, TX",
        sent: "2026-11-08T03:20:00Z",
        effective: "2026-11-08T03:20:00Z",
        expires: "2026-11-08T04:00:00Z",
        status: "Actual",
        severity: "Extreme",
      },
    },
    { id: "https://api.weather.gov/alerts/urn:oid:multi", geometry: MULTI, properties: { id: "urn:oid:multi", event: "Tornado Warning", severity: "Extreme", areaDesc: "Rockwall, TX" } },
    { id: "https://api.weather.gov/alerts/urn:oid:nogeo", geometry: null, properties: { id: "urn:oid:nogeo", event: "Tornado Watch", severity: "Severe", areaDesc: "Denton, TX", expires: "not a date" } },
  ],
};

describe("the warning layer", () => {
  it("keeps every alert, with its official fields, and lists one without a polygon", () => {
    const warnings = parseWarnings(body);
    expect(warnings).toHaveLength(3);
    const [tor, multi, nogeo] = warnings;
    expect(tor.alertId).toBe("urn:oid:2.49.0.1.840.0.tor1");
    expect(tor.officialUrl).toBe(URL1);
    expect(tor.areaDescription).toBe("Dallas, TX; Collin, TX");
    expect(tor.status).toBe("Actual");
    expect(tor.expiresAt?.toDate().toISOString()).toBe("2026-11-08T04:00:00.000Z");
    expect(JSON.parse(tor.geometry)).toEqual(POLYGON);
    expect(JSON.parse(multi.geometry).type).toBe("MultiPolygon");
    expect(multi.headline).toBe("Tornado Warning");
    expect(nogeo.geometry).toBe("");
    expect(nogeo.expiresAt).toBeUndefined();
  });

  it("ignores a body that is not a feature collection", () => {
    expect(parseWarnings(null)).toEqual([]);
    expect(parseWarnings({ features: "nope" })).toEqual([]);
  });

  it("upserts by source and alert id, and retires an alert the source stops listing", () => {
    const { tx } = harness();
    const warnings = parseWarnings(body);
    tx((ctx) => applyWarnings(ctx, "nws", warnings));
    tx((ctx) => applyWarnings(ctx, "nws", warnings));
    tx((ctx) => {
      expect(ctx.db.alert.count()).toBe(3n);
      expect([...ctx.db.alert.iter()].every((a) => a.active && a.source === "nws")).toBe(true);
    });
    tx((ctx) => applyWarnings(ctx, "nws", warnings.slice(0, 1)));
    tx((ctx) => {
      const active = [...ctx.db.alert.active.filter(true)];
      expect(active.map((a) => a.alertId)).toEqual(["urn:oid:2.49.0.1.840.0.tor1"]);
      expect(ctx.db.alert.count()).toBe(3n);
    });
  });

  it("leaves another source's alerts alone", () => {
    const { tx } = harness();
    tx((ctx) => applyWarnings(ctx, "other", parseWarnings(body).slice(0, 1)));
    tx((ctx) => applyWarnings(ctx, "nws", []));
    tx((ctx) => expect([...ctx.db.alert.active.filter(true)]).toHaveLength(1));
  });

  it("does not touch households or the reach zone", () => {
    const { tx } = harness();
    tx((ctx) => applyWarnings(ctx, "nws", parseWarnings(body)));
    tx((ctx) => expect(ctx.db.zone.count()).toBe(0n));
  });
});

describe("feed health", () => {
  it("tells loading, current and stale apart, and keeps the last success through a failure", () => {
    const { h, tx } = harness();
    tx((ctx) => recordPoll(ctx, "nws", { state: "loading" }));
    tx((ctx) => {
      const row = ctx.db.feedStatus.source.find("nws")!;
      expect(row.state).toBe("loading");
      expect(row.lastSuccessfulPollAt).toBeUndefined();
    });
    tx((ctx) => recordPoll(ctx, "nws", { state: "current" }));
    const success = tx((ctx) => ctx.db.feedStatus.source.find("nws")!.lastSuccessfulPollAt!);
    h.clock.set(Timestamp.fromDate(new Date("2026-11-08T03:27:00Z")));
    tx((ctx) => recordPoll(ctx, "nws", { state: "stale", error: "NWS answered 503" }));
    tx((ctx) => {
      const row = ctx.db.feedStatus.source.find("nws")!;
      expect(row.state).toBe("stale");
      expect(row.error).toBe("NWS answered 503");
      expect(row.lastSuccessfulPollAt?.toDate().toISOString()).toBe(success.toDate().toISOString());
      expect(row.lastAttemptAt?.toDate().toISOString()).toBe("2026-11-08T03:27:00.000Z");
      expect(ctx.db.feedStatus.count()).toBe(1n);
    });
    tx((ctx) => recordPoll(ctx, "nws", { state: "current" }));
    tx((ctx) => expect(ctx.db.feedStatus.source.find("nws")!.error).toBeUndefined());
  });
});
