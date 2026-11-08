// Live data for the floodplain map. Subscribes to the public tables the map is allowed to show and
// hands plain rows to window.LIVE (assets/live.js), which draws them. Built into assets/live-data.js.
//
// The map payload is limited on purpose: official warnings, feed health, the simulated hazard zone,
// vehicles and assignment status. No household, request, call, message or transcript table is read.

import { DbConnection } from "./module_bindings";

type Ms = number | null;
type Stamp = { toMillis(): bigint } | undefined;

export type WarningRow = {
  key: string; alertId: string; source: string; event: string; headline: string; areaDescription: string;
  geometry: string; issuedAt: Ms; effectiveAt: Ms; expiresAt: Ms; status: string; severity: string; officialUrl: string;
};
export type FeedRow = { source: string; state: string; lastSuccessfulPollAt: Ms; lastAttemptAt: Ms; error: string | null };
export type ZoneRow = { id: string; name: string; event: string; rings: string };
export type VehicleRow = { id: string; name: string; kind: string; lat: number; lng: number; simulated: boolean; seenAt: number };
export type AssignmentRow = { id: string; vehicleId: string; status: string };
export type Snapshot = { warnings: WarningRow[]; feeds: FeedRow[]; zones: ZoneRow[]; vehicles: VehicleRow[]; assignments: AssignmentRow[] };

type Live = {
  update(snapshot: Snapshot): void;
  setConnection(state: "connecting" | "live" | "disconnected" | "error", detail?: string): void;
};

const ms = (t: Stamp): Ms => (t ? Number(t.toMillis()) : null);

const params = new URLSearchParams(location.search);
const uri = params.get("uri") || "ws://127.0.0.1:3000";
const database = params.get("db") || "hackutd";
const enabled = params.get("live") !== "off";

const QUERIES = [
  "SELECT * FROM alert WHERE active = true",
  "SELECT * FROM feed_status",
  "SELECT * FROM zone WHERE source = 'stand-in'",
  "SELECT * FROM vehicle",
  "SELECT * FROM assignment",
];

function live(): Live | undefined {
  return (window as unknown as { LIVE?: Live }).LIVE;
}

function connect() {
  const warnings = new Map<string, WarningRow>();
  const feeds = new Map<string, FeedRow>();
  const zones = new Map<string, ZoneRow>();
  const vehicles = new Map<string, VehicleRow>();
  const assignments = new Map<string, AssignmentRow>();
  let queued = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    queued = false;
    live()?.update({
      warnings: [...warnings.values()],
      feeds: [...feeds.values()],
      zones: [...zones.values()],
      vehicles: [...vehicles.values()],
      assignments: [...assignments.values()],
    });
  };
  const changed = () => {
    if (queued) return;
    queued = true;
    setTimeout(flush, 100);
  };

  const scheduleRetry = () => {
    if (retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      start();
    }, 5000);
  };

  const start = () => {
    live()?.setConnection("connecting", `${database} · ${uri}`);
    DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .onConnect((conn) => {
        warnings.clear(); feeds.clear(); zones.clear(); vehicles.clear(); assignments.clear();
        const db = conn.db;

        type A = NonNullable<ReturnType<typeof db.alert.id.find>>;
        type F = NonNullable<ReturnType<typeof db.feedStatus.source.find>>;
        type Z = NonNullable<ReturnType<typeof db.zone.id.find>>;
        type V = NonNullable<ReturnType<typeof db.vehicle.id.find>>;
        type S = NonNullable<ReturnType<typeof db.assignment.id.find>>;

        const putWarning = (r: A) => {
          if (!r.active) { warnings.delete(r.key); return changed(); }
          warnings.set(r.key, {
            key: r.key, alertId: r.alertId, source: r.source, event: r.event, headline: r.headline,
            areaDescription: r.areaDescription, geometry: r.geometry, issuedAt: ms(r.issuedAt),
            effectiveAt: ms(r.effectiveAt), expiresAt: ms(r.expiresAt), status: r.status,
            severity: r.severity, officialUrl: r.officialUrl,
          });
          changed();
        };
        const putFeed = (r: F) => {
          feeds.set(r.source, { source: r.source, state: r.state, lastSuccessfulPollAt: ms(r.lastSuccessfulPollAt), lastAttemptAt: ms(r.lastAttemptAt), error: r.error ?? null });
          changed();
        };
        const putZone = (r: Z) => {
          const id = r.id.toString();
          if (!r.active || r.source !== "stand-in") zones.delete(id);
          else zones.set(id, { id, name: r.name, event: r.event, rings: r.rings });
          changed();
        };
        // Driver names are not copied: the public map labels vehicles by unit, not by person.
        const putVehicle = (r: V) => {
          const id = r.id.toString();
          vehicles.set(id, { id, name: r.name, kind: r.kind, lat: r.lat, lng: r.lng, simulated: r.simulated, seenAt: Date.now() });
          changed();
        };
        const putAssignment = (r: S) => {
          const id = r.id.toString();
          assignments.set(id, { id, vehicleId: r.vehicleId.toString(), status: r.status });
          changed();
        };

        db.alert.onInsert((_c, r) => putWarning(r));
        db.alert.onUpdate((_c, _o, r) => putWarning(r));
        db.alert.onDelete((_c, r) => { warnings.delete(r.key); changed(); });
        db.feedStatus.onInsert((_c, r) => putFeed(r));
        db.feedStatus.onUpdate((_c, _o, r) => putFeed(r));
        db.feedStatus.onDelete((_c, r) => { feeds.delete(r.source); changed(); });
        db.zone.onInsert((_c, r) => putZone(r));
        db.zone.onUpdate((_c, _o, r) => putZone(r));
        db.zone.onDelete((_c, r) => { zones.delete(r.id.toString()); changed(); });
        db.vehicle.onInsert((_c, r) => putVehicle(r));
        db.vehicle.onUpdate((_c, _o, r) => putVehicle(r));
        db.vehicle.onDelete((_c, r) => { vehicles.delete(r.id.toString()); changed(); });
        db.assignment.onInsert((_c, r) => putAssignment(r));
        db.assignment.onUpdate((_c, _o, r) => putAssignment(r));
        db.assignment.onDelete((_c, r) => { assignments.delete(r.id.toString()); changed(); });

        conn.subscriptionBuilder()
          .onApplied(() => {
            for (const r of db.alert.iter()) putWarning(r);
            for (const r of db.feedStatus.iter()) putFeed(r);
            for (const r of db.zone.iter()) putZone(r);
            for (const r of db.vehicle.iter()) putVehicle(r);
            for (const r of db.assignment.iter()) putAssignment(r);
            live()?.setConnection("live", `${database} · ${uri}`);
            flush();
          })
          .onError((ctx) => live()?.setConnection("error", String((ctx as { event?: unknown }).event ?? "subscription failed")))
          .subscribe(QUERIES);
      })
      .onConnectError((_ctx, error) => {
        live()?.setConnection("error", String(error));
        scheduleRetry();
      })
      .onDisconnect(() => {
        live()?.setConnection("disconnected");
        scheduleRetry();
      })
      .build();
  };

  start();
}

if (enabled) connect();
else live()?.setConnection("disconnected", "live data off (?live=off)");
