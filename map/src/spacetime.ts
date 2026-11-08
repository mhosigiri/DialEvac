import { DbConnection } from "./module_bindings";
import type { Vehicle, Zone } from "./module_bindings/types";

// Typed DialEvac client for the Floodplain map. One subscription per page load; MapLibre layers
// read the snapshot. Defaults to the local demo; ?uri= and ?db= can target Maincloud.

export type ConnState = "connecting" | "connected" | "error";

const DEFAULT_URI = "ws://127.0.0.1:3000";
const DEFAULT_DB = "hackutd-richardson";

const params = new URLSearchParams(location.search);
export const uri = params.get("uri") || DEFAULT_URI;
export const database = params.get("db") || DEFAULT_DB;

export function isLocalDemo() {
  try {
    const host = new URL(uri.replace(/^ws/i, "http")).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

type Listener = () => void;
export type Topic = "geometry" | "status";

const zones = new Map<string, Zone>();
const vehicles = new Map<string, Vehicle>();
const listeners = new Set<Listener>();
const geometryListeners = new Set<Listener>();
const statusListeners = new Set<Listener>();

let state: ConnState = "connecting";
let error: string | undefined;
let subscribed = false;
let connection: DbConnection | undefined;

function notify(topic: Topic | "all" = "all") {
  if (topic === "all" || topic === "geometry") for (const listener of geometryListeners) listener();
  if (topic === "all" || topic === "status") for (const listener of statusListeners) listener();
  if (topic === "all") for (const listener of listeners) listener();
}

function setState(next: ConnState, message?: string) {
  state = next;
  error = message;
  notify("status");
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeGeometry(listener: Listener) {
  geometryListeners.add(listener);
  return () => geometryListeners.delete(listener);
}

export function subscribeStatus(listener: Listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function listenerCounts() {
  return { all: listeners.size, geometry: geometryListeners.size, status: statusListeners.size };
}

export function snapshot() {
  return { state, error, uri, database, zones, vehicles };
}

export function statusLine() {
  if (state === "connecting") return `connecting · ${database}`;
  if (state === "error") return `error · ${error || "connection failed"}`;
  return `connected · ${database}`;
}

export function displayKind(row: Pick<Zone, "source">) {
  return row.source;
}

export function isExpired(_row: Zone) { return false; }

type Geom = { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

export function geometryOf(row: Zone): Geom | undefined {
  if (!row.rings) return;
  try {
    const coords = JSON.parse(row.rings) as unknown;
    if (!Array.isArray(coords) || coords.length === 0) return;
    const first = coords[0] as unknown;
    if (Array.isArray(first) && Array.isArray(first[0]) && Array.isArray(first[0][0])) {
      return { type: "MultiPolygon", coordinates: coords as number[][][][] };
    }
    return { type: "Polygon", coordinates: coords as number[][][] };
  } catch {
    return;
  }
}

export function warningCollection(): { type: "FeatureCollection"; features: object[] } {
  const features: object[] = [];
  for (const row of zones.values()) {
    if (!row.active || row.source === "stand-in") continue;
    const geometry = geometryOf(row);
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    features.push({
      type: "Feature",
      id: row.externalId,
      properties: {
        externalId: row.externalId,
        kind: displayKind(row),
        headline: row.event,
        event: row.event,
        name: row.name,
        source: row.source,
      },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

export function vehicleCollection(): { type: "FeatureCollection"; features: object[] } {
  const features: object[] = [];
  for (const row of vehicles.values()) {
    features.push({
      type: "Feature",
      id: row.id.toString(),
      properties: {
        id: row.id.toString(),
        name: row.name,
        driverName: row.driverName,
        kind: row.kind,
        simulated: row.simulated,
      },
      geometry: { type: "Point", coordinates: [row.lng, row.lat] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function feedLine() {
  const count = [...zones.values()].filter(row => row.active && row.source === "nws").length;
  return `NWS · ${count} tornado warning${count === 1 ? "" : "s"}`;
}

export function radarLine() {
  return "IEM N0Q · latest composite";
}

export function emptyWarningsReason() {
  return "No active tornado warnings.";
}

export function seedTornadoDemo() {
  if (!connection || state !== "connected" || !isLocalDemo()) return false;
  connection.reducers.seedTornadoDemo({});
  return true;
}

function upsertZone(row: Zone) {
  zones.set(row.externalId, row);
  notify("all");
}

function removeZone(row: Zone) {
  zones.delete(row.externalId);
  notify("all");
}

function upsertVehicle(row: Vehicle) {
  vehicles.set(row.id.toString(), row);
  notify("geometry");
}

function removeVehicle(row: Vehicle) {
  vehicles.delete(row.id.toString());
  notify("geometry");
}

export function connect() {
  if (connection) return connection;
  setState("connecting");
  connection = DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(database)
    .onConnect((conn) => {
      setState("connected");
      if (subscribed) return;
      subscribed = true;
      conn
        .subscriptionBuilder()
        .onApplied(() => {
          for (const row of conn.db.vehicle.iter()) vehicles.set(row.id.toString(), row);
          for (const row of conn.db.zone.iter()) zones.set(row.externalId, row);
          notify("all");
        })
        .onError((ctx) => {
          setState("error", `subscribe failed: ${String(ctx.event ?? "unknown")}`);
        })
        .subscribe(["SELECT * FROM vehicle", "SELECT * FROM zone"]);
      conn.db.vehicle.onInsert((_ctx, row) => upsertVehicle(row));
      conn.db.vehicle.onUpdate((_ctx, _old, row) => upsertVehicle(row));
      conn.db.vehicle.onDelete((_ctx, row) => removeVehicle(row));
      conn.db.zone.onInsert((_ctx, row) => upsertZone(row));
      conn.db.zone.onUpdate((_ctx, _old, row) => upsertZone(row));
      conn.db.zone.onDelete((_ctx, row) => removeZone(row));
    })
    .onConnectError((_ctx, err) => {
      setState("error", String(err));
    })
    .onDisconnect(() => {
      subscribed = false;
      setState("connecting");
    })
    .build();
  setTimeout(() => {
    if (state === "connecting") setState("error", `timed out reaching ${database}`);
  }, 12000);
  return connection;
}

connect();
