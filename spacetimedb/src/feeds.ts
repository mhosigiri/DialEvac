import { Timestamp } from "spacetimedb";
import { SenderError, t } from "spacetimedb/server";
import { feedPoll, spacetimedb } from "./schema";
import { audit, runAt, type Tx } from "./core";

// Live NWS ingestion is display-only. It never calls applyZone, starts a reach ladder, or writes a
// request. A failed poll marks health stale and deliberately preserves the last good polygons.
const NWS_ALERTS = "https://api.weather.gov/alerts/active";
const POLL_SECONDS = 120;

type NwsGeometry = { type: "Polygon"; coordinates: [number, number][][] } | { type: "MultiPolygon"; coordinates: [number, number][][][] };
type NwsFeature = {
  id?: string;
  geometry?: NwsGeometry | null;
  properties?: {
    event?: string; severity?: string; areaDesc?: string; headline?: string; sent?: string;
    expires?: string; messageType?: string; status?: string; web?: string;
  };
};

export type FeedZone = {
  externalId: string;
  name: string;
  event: string;
  severity: string;
  rings: [number, number][][];
  geometryJson: string;
  headline: string;
  issuedAt?: Timestamp;
  expiresAt?: Timestamp;
  url: string;
  messageType: string;
  area: string;
  kind: string;
};

const timestamp = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? Timestamp.fromDate(date) : undefined;
};

export function parseNwsResponse(body: unknown): { zones: FeedZone[]; malformed?: string } {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return { zones: [], malformed: "NWS answered an unknown shape" };
  const zones: FeedZone[] = [];
  for (const raw of features as NwsFeature[]) {
    const p = raw.properties;
    if (!raw.id || !p || !["Tornado Warning", "Tornado Emergency"].includes(p.event || "")) continue;
    if (!['Actual', 'Test'].includes(p.status || 'Actual') || p.status === "Test") continue;
    const geometry = raw.geometry;
    if (geometry && geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") continue;
    const rings = geometry?.type === "Polygon" ? geometry.coordinates : [];
    zones.push({
      externalId: raw.id,
      name: p.areaDesc || "Unknown area",
      event: p.event || "Tornado Warning",
      severity: p.severity || "Unknown",
      rings,
      geometryJson: geometry ? JSON.stringify(geometry) : "",
      headline: p.headline || p.event || "Tornado Warning",
      issuedAt: timestamp(p.sent),
      expiresAt: timestamp(p.expires),
      url: p.web || "",
      messageType: p.messageType || "Alert",
      area: p.areaDesc || "",
      kind: "live",
    });
  }
  return { zones };
}

export function parseAlerts(body: unknown): FeedZone[] {
  return parseNwsResponse(body).zones;
}

export function liveKind(kind: string | undefined, source: string) {
  return kind === "live" || (!kind && source === "nws");
}

export function applyZones(tx: Tx, zones: FeedZone[], source = "nws", area = "") {
  const seen = new Set(zones.map(zone => zone.externalId));
  const now = Number(tx.timestamp.toMillis());
  for (const zone of zones) {
    const existing = tx.db.zone.externalId.find(zone.externalId);
    const cancelled = zone.messageType === "Cancel";
    const expired = zone.expiresAt ? Number(zone.expiresAt.toMillis()) <= now : false;
    if (existing && cancelled) {
      tx.db.zone.id.update({ ...existing, active: false, at: tx.timestamp, messageType: "Cancel" });
      continue;
    }
    const row = {
      source, name: zone.name, event: zone.event, severity: zone.severity,
      rings: zone.rings.length ? JSON.stringify(zone.rings) : "",
      active: !cancelled && !expired, at: tx.timestamp,
      headline: zone.headline || undefined, issuedAt: zone.issuedAt, expiresAt: zone.expiresAt,
      url: zone.url || undefined, messageType: zone.messageType || undefined,
      kind: zone.kind || (source === "nws" ? "live" : "simulated"),
      geometryJson: zone.geometryJson || undefined, area: area || zone.area || undefined,
    };
    if (existing) tx.db.zone.id.update({ ...existing, ...row });
    else tx.db.zone.insert({ id: 0n, externalId: zone.externalId, ...row });
  }
  for (const row of [...tx.db.zone.active.filter(true)]) {
    if (!liveKind(row.kind, row.source)) continue;
    if (area && row.area && row.area !== area) continue;
    if (!seen.has(row.externalId)) tx.db.zone.id.update({ ...row, active: false, at: tx.timestamp });
  }
}

export function commitFeed(tx: Tx, result: { area: string; zones?: FeedZone[]; failure?: string; radarValidAt?: string }) {
  const previous = tx.db.feedHealth.id.find(0);
  if (result.failure) {
    const row = {
      id: 0, provider: "nws", area: result.area, stale: true,
      lastOkAt: previous?.lastOkAt, lastAttemptAt: tx.timestamp, error: result.failure,
      warningCount: previous?.warningCount ?? 0, radarValidAt: result.radarValidAt ?? previous?.radarValidAt,
    };
    if (previous) tx.db.feedHealth.id.update(row); else tx.db.feedHealth.insert(row);
    audit(tx, "feed", `NWS ${result.area || "unset"} stale: ${result.failure}`);
    return;
  }
  applyZones(tx, result.zones ?? [], "nws", result.area);
  const count = [...tx.db.zone.active.filter(true)].filter(row => liveKind(row.kind, row.source) && (!result.area || !row.area || row.area === result.area)).length;
  const row = {
    id: 0, provider: "nws", area: result.area, stale: false,
    lastOkAt: tx.timestamp, lastAttemptAt: tx.timestamp, error: undefined,
    warningCount: count, radarValidAt: result.radarValidAt ?? previous?.radarValidAt,
  };
  if (previous) tx.db.feedHealth.id.update(row); else tx.db.feedHealth.insert(row);
  audit(tx, "feed", `NWS ${result.area || "unset"}: ${count} live tornado warnings`);
}

export const pollFeeds = spacetimedb.procedure({ onSchedule: feedPoll }, { arg: feedPoll.rowType }, t.unit(), (ctx) => {
  const area = ctx.env.FEED_AREA || "TX";
  let zones: FeedZone[] = [];
  let failure: string | undefined;
  try {
    const response = ctx.http.fetch(`${NWS_ALERTS}?area=${encodeURIComponent(area)}&event=${encodeURIComponent("Tornado Warning")}`, {
      headers: { accept: "application/geo+json", "user-agent": "DialEvac HackUTD demo" },
    });
    if (!response.ok) failure = `NWS answered ${response.status}`;
    else {
      const parsed = parseNwsResponse(response.json());
      zones = parsed.zones;
      failure = parsed.malformed;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  ctx.withTx(tx => {
    commitFeed(tx, { area, zones, failure });
    tx.db.feedPoll.insert({ scheduledId: 0n, scheduledAt: runAt(tx, POLL_SECONDS) });
  });
  return {};
});

export const startFeeds = spacetimedb.reducer(ctx => {
  if (ctx.db.feedPoll.count() === 0n) ctx.db.feedPoll.insert({ scheduledId: 0n, scheduledAt: runAt(ctx, 0) });
});

// A canned warning near UTD for rehearsing the map without a real alert. Kind "replay" keeps it out
// of the live count and out of the live poller's deactivation sweep.
const REPLAY_ID = "replay-tornado-dfw";
const REPLAY_RINGS: [number, number][][] = [[[-96.82, 32.94], [-96.68, 32.94], [-96.68, 33.03], [-96.82, 33.03], [-96.82, 32.94]]];
const REPLAY_RINGS_UPDATED: [number, number][][] = [[[-96.8, 32.95], [-96.7, 32.95], [-96.7, 33.02], [-96.8, 33.02], [-96.8, 32.95]]];

export function replayPhase(ctx: Tx, phase: string) {
  if (phase !== "appear" && phase !== "update" && phase !== "disappear") throw new SenderError(`unknown replay phase ${phase}`);
  const rings = phase === "update" ? REPLAY_RINGS_UPDATED : REPLAY_RINGS;
  applyZones(ctx, [{
    externalId: REPLAY_ID,
    name: "Dallas, Collin",
    event: "Tornado Warning",
    severity: "Extreme",
    rings,
    geometryJson: JSON.stringify({ type: "Polygon", coordinates: rings }),
    headline: phase === "update" ? "Updated tornado warning near Richardson" : "Tornado Warning for Richardson / UTD",
    issuedAt: ctx.timestamp,
    expiresAt: Timestamp.fromDate(new Date(Number(ctx.timestamp.toMillis()) + 30 * 60_000)),
    url: "https://www.weather.gov/",
    messageType: phase === "disappear" ? "Cancel" : phase === "update" ? "Update" : "Alert",
    area: "TX",
    kind: "replay",
  }], "replay", "TX");
}

export const replayWarning = spacetimedb.reducer({ phase: t.string() }, (ctx, { phase }) => replayPhase(ctx, phase));
