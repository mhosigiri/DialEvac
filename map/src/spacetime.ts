import { DbConnection } from "./module_bindings";
import { SPACETIME_DATABASE, SPACETIME_DEMO_DATABASE, SPACETIME_URI, separateDemoDatabase } from "../../shared/spacetime";
import type { Assignment, Callback, FeedHealth, Household, Request, RoadClosure, Shelter, Vehicle, Zone } from "./module_bindings/types";

export type ConnState = "connecting" | "connected" | "error";
type Listener = () => void;

const params = new URLSearchParams(location.search);
export const uri = params.get("uri") || SPACETIME_URI;
export const database = params.get("db") || SPACETIME_DATABASE;
export const demoUri = params.get("demoUri") || SPACETIME_URI;
export const demoDatabase = params.get("demoDb") || SPACETIME_DEMO_DATABASE;

const liveZones = new Map<string, Zone>();
const liveVehicles = new Map<string, Vehicle>();
const liveAssignments = new Map<string, Assignment>();
const households = new Map<string, Household>();
const requests = new Map<string, Request>();
const assignments = new Map<string, Assignment>();
const vehicles = new Map<string, Vehicle>();
const shelters = new Map<string, Shelter>();
const callbacks = new Map<string, Callback>();
const roads = new Map<string, RoadClosure>();
const geometryListeners = new Set<Listener>();
const statusListeners = new Set<Listener>();
const demoListeners = new Set<Listener>();

let health: FeedHealth | undefined;
let liveState: ConnState = "connecting";
let liveError: string | undefined;
let demoState: ConnState = "connecting";
let demoError: string | undefined;
let liveConnection: DbConnection | undefined;
let demoConnection: DbConnection | undefined;
let liveSubscribed = false;
let demoSubscribed = false;
let liveSubscriptionCount = 0;
let demoSubscriptionCount = 0;

const key = (id: bigint | number) => id.toString();
const notify = (listeners: Set<Listener>) => { for (const listener of listeners) listener(); };
export const subscribeGeometry = (listener: Listener) => { geometryListeners.add(listener); return () => geometryListeners.delete(listener); };
export const subscribeStatus = (listener: Listener) => { statusListeners.add(listener); return () => statusListeners.delete(listener); };
export const subscribeDemo = (listener: Listener) => { demoListeners.add(listener); return () => demoListeners.delete(listener); };
export function listenerCounts() { return { geometry: geometryListeners.size, status: statusListeners.size, demo: demoListeners.size, liveSubscriptions: liveSubscriptionCount, demoSubscriptions: demoSubscriptionCount }; }

export function snapshot() { return { state: liveState, error: liveError, uri, database, zones: liveZones, vehicles: liveVehicles, assignments: liveAssignments, health }; }
export function demoSnapshot() { return { state: demoState, error: demoError, uri: demoUri, database: demoDatabase, households, requests, assignments, vehicles, shelters, callbacks, roads }; }
export function isSeparateDemo() {
  return separateDemoDatabase(demoUri, demoDatabase, uri, database);
}

const microsToMs = (value: Zone["expiresAt"] | Zone["issuedAt"] | FeedHealth["lastOkAt"] | undefined) => {
  if (!value || typeof value !== "object" || !("microsSinceUnixEpoch" in value)) return undefined;
  return Number(BigInt(value.microsSinceUnixEpoch) / 1000n);
};
export function isExpired(row: Zone) { const ms = microsToMs(row.expiresAt); return ms !== undefined && ms <= Date.now(); }
export function formatTs(value: Zone["expiresAt"] | Zone["issuedAt"] | undefined) {
  const ms = microsToMs(value); return ms === undefined ? "" : new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
export function displayKind(row: Pick<Zone, "kind" | "source">) { return row.kind || row.source; }
export function statusLine() {
  if (liveState === "connecting") return `connecting · ${database}`;
  if (liveState === "error") return `disconnected · ${liveError || "connection failed"}`;
  return `connected · ${database}`;
}
export function isLiveWarning(row: Zone) {
  return row.active && !isExpired(row) && (displayKind(row) === "live" || (!row.kind && row.source === "nws"));
}
export function liveWarnings() {
  return [...liveZones.values()].filter(isLiveWarning)
    .sort((a, b) => (microsToMs(a.expiresAt) ?? Infinity) - (microsToMs(b.expiresAt) ?? Infinity));
}

// The poller runs every 2 minutes; three missed polls is stale even if the last write said fresh.
const STALE_MS = 6 * 60 * 1000;
export type Tone = "ok" | "alert" | "warn" | "muted";
export function feedSummary(now = Date.now()): { tone: Tone; text: string } {
  if (liveState === "connecting") return { tone: "warn", text: "Connecting to live data…" };
  if (liveState === "error") return { tone: "warn", text: "Live data offline · warnings are not updating" };
  if (!health) return { tone: "warn", text: "Waiting for the NWS warning feed" };
  const okAt = microsToMs(health.lastOkAt);
  const clock = (ms: number | undefined) => ms === undefined ? "never" : new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (health.stale || okAt === undefined || now - okAt >= STALE_MS) return { tone: "warn", text: `Unable to refresh warnings · last update ${clock(okAt)}` };
  const n = liveWarnings().length;
  return { tone: n ? "alert" : "ok", text: `${n || "No"} active tornado warning${n === 1 ? "" : "s"} · NWS ${health.area || ""} updated ${clock(okAt)}`.replace("  ", " ") };
}

export type VehicleStatus = "available" | "assigned" | "en_route";
export function vehicleStatus(vehicleId: bigint) {
  let status: VehicleStatus = "available";
  for (const a of liveAssignments.values()) {
    if (a.vehicleId !== vehicleId) continue;
    if (a.status === "accepted") return "en_route";
    if (a.status === "proposed" || a.status === "offered") status = "assigned";
  }
  return status;
}
export function fleetCounts() {
  const counts = { available: 0, assigned: 0, en_route: 0, simulated: 0, total: liveVehicles.size };
  for (const v of liveVehicles.values()) { counts[vehicleStatus(v.id)] += 1; if (v.simulated) counts.simulated += 1; }
  return counts;
}
// Driver names stay off the public map: vehicles are labelled by unit.
export function vehicleCollection() {
  const label = { available: "Available", assigned: "Assigned", en_route: "En route" };
  const features = [...liveVehicles.values()].map(v => {
    const status = vehicleStatus(v.id);
    return { type: "Feature", properties: { id: key(v.id), status, simulated: v.simulated, label: `${v.name} · ${label[status]}${v.simulated ? " · SIM" : ""}` }, geometry: { type: "Point", coordinates: [v.lng, v.lat] } };
  });
  return { type: "FeatureCollection" as const, features };
}
export function demoStatusLine() {
  if (demoState === "connecting") return `demo connecting · ${demoDatabase}`;
  if (demoState === "error") return `demo unavailable · ${demoError || "connection failed"}`;
  if (demoError) return `demo failed · ${demoError}`;
  return `demo connected · ${demoDatabase}`;
}
export function radarLine() { return health?.radarValidAt ? `IEM N0Q · ${health.radarValidAt}` : "IEM N0Q · latest composite"; }

type Geom = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
export function geometryOf(row: Zone): Geom | undefined {
  for (const raw of [row.geometryJson, row.rings]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { type?: string; coordinates?: unknown } | unknown[];
      if (!Array.isArray(parsed) && (parsed.type === "Polygon" || parsed.type === "MultiPolygon")) return parsed as Geom;
      if (Array.isArray(parsed) && parsed.length) {
        const first = parsed[0] as unknown;
        return Array.isArray(first) && Array.isArray(first[0]) && Array.isArray(first[0][0])
          ? { type: "MultiPolygon", coordinates: parsed as number[][][][] }
          : { type: "Polygon", coordinates: parsed as number[][][] };
      }
    } catch { /* try legacy geometry */ }
  }
  return undefined;
}
export function warningCollection() {
  const features: object[] = [];
  for (const row of liveWarnings()) {
    const geometry = geometryOf(row); if (!geometry) continue;
    features.push({ type: "Feature", id: row.externalId, properties: { externalId: row.externalId, kind: "live", headline: row.headline || row.event, event: row.event, name: row.name, source: row.source, expiry: formatTs(row.expiresAt), url: row.url || "" }, geometry });
  }
  return { type: "FeatureCollection" as const, features };
}

async function runDemoReducer(run: (connection: DbConnection) => Promise<unknown>) {
  if (!demoConnection || demoState !== "connected" || !isSeparateDemo()) return false;
  try {
    await run(demoConnection);
    demoError = undefined; notify(statusListeners);
    return true;
  } catch (error) {
    demoError = String(error); notify(statusListeners);
    return false;
  }
}
export function seedTornadoDemo() {
  return runDemoReducer(connection => connection.reducers.seedTornadoDemo({}));
}
export function seedAssistanceDemo() {
  return runDemoReducer(connection => connection.reducers.seedAssistanceDemo({}));
}
export function advanceAssistanceDemo(phase: "approve" | "accept") {
  return runDemoReducer(connection => connection.reducers.advanceAssistanceDemo({ phase }));
}

function connectLive() {
  if (liveConnection) return;
  liveConnection = DbConnection.builder().withUri(uri).withDatabaseName(database)
    .onConnect(conn => {
      liveState = "connected"; liveError = undefined; notify(statusListeners);
      // The public map only reads. Operators start the feed independently of page connections.
      if (liveSubscribed) return;
      liveSubscribed = true; liveSubscriptionCount += 1;
      conn.subscriptionBuilder().onApplied(() => {
        liveZones.clear(); for (const row of conn.db.zone.iter()) liveZones.set(row.externalId, row);
        liveVehicles.clear(); for (const row of conn.db.vehicle.iter()) liveVehicles.set(key(row.id), row);
        liveAssignments.clear(); for (const row of conn.db.assignment.iter()) liveAssignments.set(key(row.id), row);
        health = [...conn.db.feedHealth.iter()][0]; notify(geometryListeners); notify(statusListeners);
      }).onError(ctx => { liveState = "error"; liveError = `subscription failed: ${String(ctx.event ?? "unknown")}`; notify(statusListeners); })
        .subscribe(["SELECT * FROM zone", "SELECT * FROM feed_health", "SELECT * FROM vehicle", "SELECT * FROM assignment"]);
      conn.db.vehicle.onInsert((_ctx, row) => { liveVehicles.set(key(row.id), row); notify(geometryListeners); });
      conn.db.vehicle.onUpdate((_ctx, _old, row) => { liveVehicles.set(key(row.id), row); notify(geometryListeners); });
      conn.db.vehicle.onDelete((_ctx, row) => { liveVehicles.delete(key(row.id)); notify(geometryListeners); });
      conn.db.assignment.onInsert((_ctx, row) => { liveAssignments.set(key(row.id), row); notify(geometryListeners); });
      conn.db.assignment.onUpdate((_ctx, _old, row) => { liveAssignments.set(key(row.id), row); notify(geometryListeners); });
      conn.db.assignment.onDelete((_ctx, row) => { liveAssignments.delete(key(row.id)); notify(geometryListeners); });
      conn.db.zone.onInsert((_ctx, row) => { liveZones.set(row.externalId, row); notify(geometryListeners); });
      conn.db.zone.onUpdate((_ctx, _old, row) => { liveZones.set(row.externalId, row); notify(geometryListeners); });
      conn.db.zone.onDelete((_ctx, row) => { liveZones.delete(row.externalId); notify(geometryListeners); });
      conn.db.feedHealth.onInsert((_ctx, row) => { health = row; notify(statusListeners); });
      conn.db.feedHealth.onUpdate((_ctx, _old, row) => { health = row; notify(statusListeners); });
    }).onConnectError((_ctx, err) => { liveState = "error"; liveError = String(err); notify(statusListeners); })
    .onDisconnect(() => { liveState = "error"; liveError = "connection closed"; notify(statusListeners); }).build();
}

function connectDemo() {
  if (demoConnection) return;
  if (!isSeparateDemo()) {
    demoState = "error"; demoError = "Select a dedicated demo database, separate from the operational database";
    notify(demoListeners); notify(statusListeners);
    return;
  }
  demoConnection = DbConnection.builder().withUri(demoUri).withDatabaseName(demoDatabase)
    .onConnect(conn => {
      demoState = "connected"; demoError = undefined; notify(demoListeners); notify(statusListeners);
      if (demoSubscribed) return;
      demoSubscribed = true; demoSubscriptionCount += 1;
      conn.subscriptionBuilder().onApplied(() => {
        for (const row of conn.db.household.iter()) households.set(key(row.id), row);
        for (const row of conn.db.request.iter()) requests.set(key(row.id), row);
        for (const row of conn.db.assignment.iter()) assignments.set(key(row.id), row);
        for (const row of conn.db.vehicle.iter()) vehicles.set(key(row.id), row);
        for (const row of conn.db.shelter.iter()) shelters.set(key(row.id), row);
        for (const row of conn.db.callback.iter()) callbacks.set(key(row.id), row);
        for (const row of conn.db.roadClosure.iter()) roads.set(key(row.id), row);
        notify(demoListeners);
      }).onError(ctx => { demoState = "error"; demoError = `subscription failed: ${String(ctx.event ?? "unknown")}`; notify(demoListeners); })
        .subscribe(["SELECT * FROM household", "SELECT * FROM request", "SELECT * FROM assignment", "SELECT * FROM vehicle", "SELECT * FROM shelter", "SELECT * FROM callback", "SELECT * FROM road_closure"]);
      const wire = <T>(table: { onInsert: (cb: (ctx: unknown, row: T) => void) => void; onUpdate: (cb: (ctx: unknown, old: T, row: T) => void) => void; onDelete: (cb: (ctx: unknown, row: T) => void) => void }, rows: Map<string, T>, idOf: (row: T) => bigint | number) => {
        table.onInsert((_ctx, row) => { rows.set(key(idOf(row)), row); notify(demoListeners); });
        table.onUpdate((_ctx, _old, row) => { rows.set(key(idOf(row)), row); notify(demoListeners); });
        table.onDelete((_ctx, row) => { rows.delete(key(idOf(row))); notify(demoListeners); });
      };
      wire(conn.db.household, households, row => row.id); wire(conn.db.request, requests, row => row.id);
      wire(conn.db.assignment, assignments, row => row.id); wire(conn.db.vehicle, vehicles, row => row.id);
      wire(conn.db.shelter, shelters, row => row.id); wire(conn.db.callback, callbacks, row => row.id);
      wire(conn.db.roadClosure, roads, row => row.id);
    }).onConnectError((_ctx, err) => { demoState = "error"; demoError = String(err); notify(demoListeners); notify(statusListeners); })
    .onDisconnect(() => { demoState = "error"; demoError = "connection closed"; notify(demoListeners); }).build();
}

connectLive();
connectDemo();
setTimeout(() => { if (liveState === "connecting") { liveState = "error"; liveError = `timed out reaching ${database}`; notify(statusListeners); } }, 12000);
setTimeout(() => { if (demoState === "connecting") { demoState = "error"; demoError = `timed out reaching ${demoDatabase}`; notify(demoListeners); } }, 5000);
