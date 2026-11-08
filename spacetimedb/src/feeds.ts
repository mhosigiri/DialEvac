import { Timestamp } from "spacetimedb";
import { t } from "spacetimedb/server";
import { feedPoll, spacetimedb } from "./schema";
import { audit, runAt, type Tx } from "./core";
import { applyZone } from "./households";

// Live warnings, in place of the Apify Actor. A scheduled procedure reads the National Weather
// Service's active alerts (public, no key) for FEED_AREA, keeps each alert's polygon as a zone, and
// puts homes inside a severe or extreme one into the warning zone.

const NWS_ALERTS = "https://api.weather.gov/alerts/active";
const POLL_SECONDS = 120;
const ACTIONABLE = ["Severe", "Extreme"];

type NwsFeature = {
  id: string;
  geometry: { type: string; coordinates: [number, number][][] } | null;
  properties: { event: string; severity: string; areaDesc: string; headline?: string };
};

export type FeedZone = { externalId: string; name: string; event: string; severity: string; rings: [number, number][][] };

export function parseAlerts(body: unknown): FeedZone[] {
  const features = (body as { features?: NwsFeature[] })?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f) =>
    f.geometry?.type === "Polygon" && Array.isArray(f.geometry.coordinates)
      ? [{ externalId: f.id, name: f.properties.areaDesc, event: f.properties.event, severity: f.properties.severity, rings: f.geometry.coordinates }]
      : [],
  );
}

export function applyZones(tx: Tx, zones: FeedZone[]) {
  const seen = new Set(zones.map((z) => z.externalId));
  let opened = 0;
  for (const z of zones) {
    const existing = tx.db.zone.externalId.find(z.externalId);
    const row = { ...z, source: "nws", rings: JSON.stringify(z.rings), active: true, at: tx.timestamp };
    if (existing) tx.db.zone.id.update({ ...existing, ...row });
    else {
      tx.db.zone.insert({ id: 0n, ...row });
      opened += 1;
      if (ACTIONABLE.includes(z.severity)) {
        const entered = applyZone(tx, z.rings);
        audit(tx, "feed", `${z.event} for ${z.name}: ${entered} homes entered the warning zone`);
      }
    }
  }
  for (const z of [...tx.db.zone.active.filter(true)]) {
    if (z.source === "nws" && !seen.has(z.externalId)) tx.db.zone.id.update({ ...z, active: false, at: tx.timestamp });
  }
  return opened;
}

// The map's copy of every alert, kept apart from zones: zones drive who gets reached, warnings are
// what the public map shows. An alert without a polygon is kept with geometry "" so it can be listed.

const NWS_SOURCE = "nws";

type NwsAlert = {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: {
    "@id"?: string;
    id?: string;
    event?: string;
    headline?: string | null;
    areaDesc?: string;
    sent?: string;
    effective?: string;
    expires?: string;
    status?: string;
    severity?: string;
  };
};

export type Warning = {
  alertId: string;
  event: string;
  headline: string;
  areaDescription: string;
  geometry: string;
  issuedAt: Timestamp | undefined;
  effectiveAt: Timestamp | undefined;
  expiresAt: Timestamp | undefined;
  status: string;
  severity: string;
  officialUrl: string;
};

function stamp(value: string | undefined): Timestamp | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : Timestamp.fromDate(date);
}

function geometryOf(f: NwsAlert): string {
  const g = f.geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !Array.isArray(g.coordinates)) return "";
  return JSON.stringify({ type: g.type, coordinates: g.coordinates });
}

export function parseWarnings(body: unknown): Warning[] {
  const features = (body as { features?: NwsAlert[] })?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f) => {
    const p = f.properties ?? {};
    const url = p["@id"] ?? f.id ?? "";
    const alertId = p.id ?? f.id ?? url;
    if (!alertId) return [];
    return [{
      alertId,
      event: p.event ?? "",
      headline: p.headline ?? p.event ?? "",
      areaDescription: p.areaDesc ?? "",
      geometry: geometryOf(f),
      issuedAt: stamp(p.sent),
      effectiveAt: stamp(p.effective),
      expiresAt: stamp(p.expires),
      status: p.status ?? "",
      severity: p.severity ?? "",
      officialUrl: url.startsWith("https://") ? url : "",
    }];
  });
}

// Upserts by source and alert id; an alert the source no longer lists goes inactive.
export function applyWarnings(tx: Tx, source: string, warnings: Warning[]) {
  const seen = new Set<string>();
  for (const w of warnings) {
    const key = `${source}:${w.alertId}`;
    seen.add(key);
    const row = { key, source, ...w, active: true, updatedAt: tx.timestamp };
    const existing = tx.db.alert.key.find(key);
    if (existing) tx.db.alert.id.update({ ...existing, ...row });
    else tx.db.alert.insert({ id: 0n, ...row });
  }
  for (const a of [...tx.db.alert.active.filter(true)]) {
    if (a.source === source && !seen.has(a.key)) tx.db.alert.id.update({ ...a, active: false, updatedAt: tx.timestamp });
  }
}

export type PollResult = { state: "current" } | { state: "stale"; error: string } | { state: "off" } | { state: "loading" };

// One row per source. A failed poll keeps the last success time, so the map can say how old its data is.
export function recordPoll(tx: Tx, source: string, result: PollResult) {
  const existing = tx.db.feedStatus.source.find(source);
  const attempted = result.state === "current" || result.state === "stale";
  const row = {
    source,
    state: result.state,
    lastSuccessfulPollAt: result.state === "current" ? tx.timestamp : existing?.lastSuccessfulPollAt,
    lastAttemptAt: attempted ? tx.timestamp : existing?.lastAttemptAt,
    error: result.state === "stale" ? result.error : undefined,
  };
  if (existing) tx.db.feedStatus.source.update(row);
  else tx.db.feedStatus.insert(row);
}

export const pollFeeds = spacetimedb.procedure({ onSchedule: feedPoll }, { arg: feedPoll.rowType }, t.unit(), (ctx) => {
  const area = ctx.env.FEED_AREA;
  let zones: FeedZone[] = [];
  let warnings: Warning[] = [];
  let failure: string | undefined;
  if (area) {
    try {
      const response = ctx.http.fetch(`${NWS_ALERTS}?area=${encodeURIComponent(area)}`, {
        headers: { accept: "application/geo+json", "user-agent": "hackutd-response (feed poller)" },
      });
      if (response.ok) {
        const body = response.json();
        zones = parseAlerts(body);
        warnings = parseWarnings(body);
      } else failure = `NWS answered ${response.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  ctx.withTx((tx) => {
    if (failure) {
      audit(tx, "feed", `feed poll failed: ${failure}`);
      recordPoll(tx, NWS_SOURCE, { state: "stale", error: failure });
    } else if (area) {
      applyZones(tx, zones);
      applyWarnings(tx, NWS_SOURCE, warnings);
      recordPoll(tx, NWS_SOURCE, { state: "current" });
    } else recordPoll(tx, NWS_SOURCE, { state: "off" });
    tx.db.feedPoll.insert({ scheduledId: 0n, scheduledAt: runAt(tx, POLL_SECONDS) });
  });
  return {};
});

// Starts the poll loop. Idempotent: a second call while one is scheduled does nothing.
export const startFeeds = spacetimedb.reducer((ctx) => {
  if (ctx.db.feedPoll.count() > 0n) return;
  if (!ctx.db.feedStatus.source.find(NWS_SOURCE)) recordPoll(ctx, NWS_SOURCE, { state: "loading" });
  ctx.db.feedPoll.insert({ scheduledId: 0n, scheduledAt: runAt(ctx, 0) });
});
