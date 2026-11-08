import { TimeDuration } from "spacetimedb";
import { SenderError, t } from "spacetimedb/server";
import { routeJob, spacetimedb } from "./schema";
import { requireInternal, requireOperator } from "./authorization";
import { runAt, type Tx } from "./core";
import { LIVE_ASSIGNMENT } from "./domain/status";
import { metersBetween, metersToSegment, type Point } from "./domain/geo";

export const requestDispatchRoute = spacetimedb.reducer({ assignmentId: t.u64() }, (ctx, { assignmentId }) => {
  requireOperator(ctx);
  const a = ctx.db.assignment.id.find(assignmentId), request = a && ctx.db.request.id.find(a.requestId);
  const v = a && ctx.db.vehicle.id.find(a.vehicleId), home = request && ctx.db.household.id.find(request.householdId);
  if (!a || !request || request.status === "closed" || !(LIVE_ASSIGNMENT as readonly string[]).includes(a.status) || !v || !home) throw new SenderError("route requires a live assignment and open request");
  const previous = ctx.db.dispatchRoute.assignmentId.find(assignmentId);
  if (previous?.state === "pending") return;
  const revision = (previous?.revision ?? 0n) + 1n;
  const row = { assignmentId, requestId: request.id, vehicleId: v.id, originLat: v.lat, originLng: v.lng, destinationLat: home.lat, destinationLng: home.lng,
    points: [], distanceMeters: undefined, durationSeconds: undefined, source: "osrm", state: "pending", failureReason: undefined, revision, updatedAt: ctx.timestamp };
  if (previous) ctx.db.dispatchRoute.assignmentId.update(row); else ctx.db.dispatchRoute.insert(row);
  ctx.db.routeJob.insert({ scheduledId: 0n, scheduledAt: runAt(ctx, 0), assignmentId, revision });
});

export function parseRoadRoute(body: unknown): { points: Point[]; distanceMeters: number; durationSeconds: number } {
  const raw = body as { code?: string; routes?: { distance?: unknown; duration?: unknown; geometry?: { type?: string; coordinates?: unknown } }[] };
  const route = raw?.code === "Ok" ? raw.routes?.[0] : undefined;
  if (!route || typeof route.distance !== "number" || !Number.isFinite(route.distance) || route.distance < 0 ||
    typeof route.duration !== "number" || !Number.isFinite(route.duration) || route.duration < 0 || route.geometry?.type !== "LineString" ||
    !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2 || route.geometry.coordinates.length > 10_000) throw new Error("Invalid road route");
  const points = route.geometry.coordinates.map((p: unknown) => {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== "number" || typeof p[1] !== "number" || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new Error("Invalid road coordinates");
    return { lat: p[1], lng: p[0] };
  });
  return { points, distanceMeters: route.distance, durationSeconds: route.duration };
}

type RouteRow = NonNullable<ReturnType<Tx["db"]["dispatchRoute"]["assignmentId"]["find"]>>;
export function commitRoadRoute(tx: Tx, snapshot: RouteRow, route: ReturnType<typeof parseRoadRoute> | undefined, failureReason?: string) {
  const current = tx.db.dispatchRoute.assignmentId.find(snapshot.assignmentId);
  if (!current || current.revision !== snapshot.revision || current.state !== "pending") return;
  const assignment = tx.db.assignment.id.find(current.assignmentId), request = tx.db.request.id.find(current.requestId);
  const vehicle = tx.db.vehicle.id.find(current.vehicleId), home = request && tx.db.household.id.find(request.householdId);
  if (!assignment || !(LIVE_ASSIGNMENT as readonly string[]).includes(assignment.status) || request?.status === "closed") failureReason = "Assignment or request is no longer active";
  else if (!vehicle || !home || vehicle.lat !== current.originLat || vehicle.lng !== current.originLng || home.lat !== current.destinationLat || home.lng !== current.destinationLng) failureReason = "Responder or resident location changed; request a fresh route";
  else if (route && (metersBetween(route.points[0], vehicle) > 1000 || metersBetween(route.points.at(-1)!, home) > 1000)) failureReason = "Road route does not reach the requested locations";
  else if (route && [...tx.db.roadClosure.active.filter(true)].some(closure => route.points.slice(1).some((point, i) => metersToSegment(closure, route.points[i], point) < 150))) failureReason = "Road route intersects a reported closure";
  tx.db.dispatchRoute.assignmentId.update({ ...current, state: route && !failureReason ? "ready" : "failed", points: failureReason ? [] : route?.points ?? [],
    distanceMeters: failureReason ? undefined : route?.distanceMeters, durationSeconds: failureReason ? undefined : route?.durationSeconds,
    failureReason: failureReason || (route ? undefined : "Routing provider unavailable"), updatedAt: tx.timestamp });
}

export const calculateDispatchRoute = spacetimedb.procedure({ onSchedule: routeJob }, { arg: routeJob.rowType }, t.unit(), (ctx, { arg }) => {
  requireInternal(ctx);
  const snapshot = ctx.withTx(tx => tx.db.dispatchRoute.assignmentId.find(arg.assignmentId));
  if (!snapshot || snapshot.revision !== arg.revision || snapshot.state !== "pending") return {};
  let route: ReturnType<typeof parseRoadRoute> | undefined;
  let failureReason: string | undefined;
  try {
    const root = ctx.env.ROUTER_URL || "https://router.project-osrm.org";
    const url = `${root.replace(/\/$/, "")}/route/v1/driving/${snapshot.originLng},${snapshot.originLat};${snapshot.destinationLng},${snapshot.destinationLat}?overview=full&geometries=geojson&steps=false`;
    const response = ctx.http.fetch(url, { timeout: TimeDuration.fromMillis(5000) });
    if (!response.ok) throw new Error("Routing provider unavailable");
    route = parseRoadRoute(response.json());
  } catch { failureReason = "Routing provider unavailable or no valid road route returned"; }
  ctx.withTx(tx => commitRoadRoute(tx, snapshot, route, failureReason));
  return {};
});
