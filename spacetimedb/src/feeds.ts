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

export const pollFeeds = spacetimedb.procedure({ onSchedule: feedPoll }, { arg: feedPoll.rowType }, t.unit(), (ctx) => {
  const area = ctx.env.FEED_AREA;
  let zones: FeedZone[] = [];
  let failure: string | undefined;
  if (area) {
    try {
      const response = ctx.http.fetch(`${NWS_ALERTS}?area=${encodeURIComponent(area)}`, {
        headers: { accept: "application/geo+json", "user-agent": "hackutd-response (feed poller)" },
      });
      if (response.ok) zones = parseAlerts(response.json());
      else failure = `NWS answered ${response.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  ctx.withTx((tx) => {
    if (failure) audit(tx, "feed", `feed poll failed: ${failure}`);
    else if (area) applyZones(tx, zones);
    tx.db.feedPoll.insert({ scheduledId: 0n, scheduledAt: runAt(tx, POLL_SECONDS) });
  });
  return {};
});

// Starts the poll loop. Idempotent: a second call while one is scheduled does nothing.
export const startFeeds = spacetimedb.reducer((ctx) => {
  if (ctx.db.feedPoll.count() > 0n) return;
  ctx.db.feedPoll.insert({ scheduledId: 0n, scheduledAt: runAt(ctx, 0) });
});
