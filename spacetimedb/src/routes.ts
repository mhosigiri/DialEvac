import { TimeDuration } from "spacetimedb";
import { SenderError, t } from "spacetimedb/server";
import { routeJob, routeTimeout, routePoint, spacetimedb } from "./schema";
import { requireInternal, requireOperator, requireService } from "./authorization";
import { runAt, type Tx } from "./core";
import { parseRoadRoute } from "../../shared/routing";
import { LIVE_ASSIGNMENT } from "./domain/status";
import { metersBetween, metersToSegment, type Point } from "./domain/geo";
import { parseRouteSteps, routeMatchesLocations } from "../../shared/route-guidance";

const ROUTE_TIMEOUT_SECONDS = 30;

export const requestDispatchRoute = spacetimedb.reducer({ assignmentId: t.u64() }, (ctx, { assignmentId }) => {
  requireOperator(ctx);
  queueDispatchRoute(ctx, assignmentId);
});

export function queueDispatchRoute(ctx: Tx, assignmentId: bigint) {
  const a = ctx.db.assignment.id.find(assignmentId), request = a && ctx.db.request.id.find(a.requestId);
  const v = a && ctx.db.vehicle.id.find(a.vehicleId), home = request && ctx.db.household.id.find(request.householdId);
  if (!a || !request || request.status === "closed" || !(LIVE_ASSIGNMENT as readonly string[]).includes(a.status) || !v || !home) throw new SenderError("route requires a live assignment and open request");
  const previous = ctx.db.dispatchRoute.assignmentId.find(assignmentId);
  if (previous?.state === "pending" && routeMatchesLocations(previous, v, home) && ctx.timestamp.microsSinceUnixEpoch - previous.updatedAt.microsSinceUnixEpoch < BigInt(ROUTE_TIMEOUT_SECONDS) * 1_000_000n) return;
  const revision = (previous?.revision ?? 0n) + 1n;
  const row = { assignmentId, requestId: request.id, vehicleId: v.id, originLat: v.lat, originLng: v.lng, destinationLat: home.lat, destinationLng: home.lng,
    points: [], distanceMeters: undefined, durationSeconds: undefined, source: "osmnx", state: "pending", failureReason: undefined, revision, updatedAt: ctx.timestamp };
  if (previous) ctx.db.dispatchRoute.assignmentId.update(row); else ctx.db.dispatchRoute.insert(row);
  ctx.db.routeJob.insert({ scheduledId: 0n, scheduledAt: runAt(ctx, 0), assignmentId, revision });
  ctx.db.routeTimeout.insert({ scheduledId: 0n, scheduledAt: runAt(ctx, ROUTE_TIMEOUT_SECONDS), assignmentId, revision });
}

export const expireDispatchRoute = spacetimedb.reducer({ onSchedule: routeTimeout }, { arg: routeTimeout.rowType }, (ctx, { arg }) => {
  requireInternal(ctx);
  const current = ctx.db.dispatchRoute.assignmentId.find(arg.assignmentId);
  if (!current || current.revision !== arg.revision || current.state !== "pending") return;
  ctx.db.dispatchRoute.assignmentId.update({ ...current, state: "failed", failureReason: "Routing provider timed out; request a fresh route", updatedAt: ctx.timestamp });
});

export { parseRoadRoute } from "../../shared/routing";

type RouteRow = NonNullable<ReturnType<Tx["db"]["dispatchRoute"]["assignmentId"]["find"]>>;
export function commitRoadRoute(tx: Tx, snapshot: RouteRow, route: ReturnType<typeof parseRoadRoute> | undefined, failureReason?: string) {
  const current = tx.db.dispatchRoute.assignmentId.find(snapshot.assignmentId);
  if (!current || current.revision !== snapshot.revision || current.state !== "pending") return;
  const assignment = tx.db.assignment.id.find(current.assignmentId), request = tx.db.request.id.find(current.requestId);
  const vehicle = tx.db.vehicle.id.find(current.vehicleId), home = request && tx.db.household.id.find(request.householdId);
  if (!assignment || !(LIVE_ASSIGNMENT as readonly string[]).includes(assignment.status) || request?.status === "closed") failureReason = "Assignment or request is no longer active";
  else if (!vehicle || !home || !routeMatchesLocations({ ...current, points: route?.points ?? current.points }, vehicle, home)) failureReason = "Responder or resident location changed; request a fresh route";
  else if (route && (metersBetween(route.points[0], { lat: current.originLat, lng: current.originLng }) > 1000 || metersBetween(route.points.at(-1)!, home) > 1000)) failureReason = "Road route does not reach the requested locations";
  else if (route && [...tx.db.roadClosure.active.filter(true)].some(closure => route.points.slice(1).some((point, i) => metersToSegment(closure, route.points[i], point) < 150))) failureReason = "Road route intersects a reported closure";
  tx.db.dispatchRoute.assignmentId.update({ ...current, state: route && !failureReason ? "ready" : "failed", points: failureReason ? [] : route?.points ?? [],
    distanceMeters: failureReason ? undefined : route?.distanceMeters, durationSeconds: failureReason ? undefined : route?.durationSeconds,
    failureReason: failureReason || (route ? undefined : "Routing provider unavailable"), updatedAt: tx.timestamp });
}

// The external route-only worker can supply OSMnx geometry when the native HTTP environment
// cannot reach the provider. It cannot revive stale/closed routes or skip module validation.
export const recordDispatchRoute = spacetimedb.reducer({ assignmentId: t.u64(), revision: t.u64(), points: t.array(routePoint),
  distanceMeters: t.option(t.f64()), durationSeconds: t.option(t.f64()), failureReason: t.option(t.string()) },
  (ctx, { assignmentId, revision, points, distanceMeters, durationSeconds, failureReason }) => {
    requireService(ctx);
    const row = ctx.db.dispatchRoute.assignmentId.find(assignmentId);
    if (!row || row.revision !== revision || (row.state !== "pending" && !(row.state === "failed" && row.failureReason?.startsWith("Routing provider")))) return;
    let route: ReturnType<typeof parseRoadRoute> | undefined;
    if (!failureReason) route = parseRoadRoute({ code: "Ok", routes: [{ distance: distanceMeters, duration: durationSeconds,
      geometry: { type: "LineString", coordinates: points.map(point => [point.lng, point.lat]) } }] });
    const pending = { ...row, state: "pending" };
    ctx.db.dispatchRoute.assignmentId.update(pending);
    commitRoadRoute(ctx, pending, route, failureReason ? "Routing provider unavailable through the service bridge" : undefined);
  });

export const recordRouteGuidance = spacetimedb.reducer({ assignmentId: t.u64(), revision: t.u64(), stepsJson: t.string(), summary: t.option(t.string()), model: t.option(t.string()), error: t.option(t.string()) }, (ctx, args) => {
  requireService(ctx);
  const route = ctx.db.dispatchRoute.assignmentId.find(args.assignmentId);
  if (!route || route.state !== "ready" || route.revision !== args.revision) return;
  const assignment = ctx.db.assignment.id.find(args.assignmentId), request = assignment && ctx.db.request.id.find(assignment.requestId);
  const vehicle = assignment && ctx.db.vehicle.id.find(assignment.vehicleId), home = request && ctx.db.household.id.find(request.householdId);
  if (!assignment || !(LIVE_ASSIGNMENT as readonly string[]).includes(assignment.status) || !request || request.status === "closed" || !vehicle || !home || !routeMatchesLocations(route, vehicle, home)) return;
  if (args.stepsJson.length > 200_000 || (args.summary?.length ?? 0) > 2000 || (args.model?.length ?? 0) > 100 || (args.error?.length ?? 0) > 300 ||
    (args.summary !== undefined && (!args.summary.trim() || !args.model?.trim() || args.error !== undefined))) throw new SenderError("Invalid route guidance");
  let steps;
  try { steps = parseRouteSteps(JSON.parse(args.stepsJson)); } catch { throw new SenderError("Invalid route directions"); }
  if (steps.some(step => !route.points.slice(1).some((point, i) => metersToSegment(step, route.points[i], point) <= 250))) throw new SenderError("Directions do not follow the accepted road route");
  const row = { assignmentId: args.assignmentId, revision: args.revision, stepsJson: JSON.stringify(steps), summary: args.summary, model: args.model,
    state: args.summary ? "ready" : "failed", error: args.error, updatedAt: ctx.timestamp };
  if (ctx.db.routeGuidance.assignmentId.find(args.assignmentId)) ctx.db.routeGuidance.assignmentId.update(row); else ctx.db.routeGuidance.insert(row);
});

export const calculateDispatchRoute = spacetimedb.procedure({ onSchedule: routeJob }, { arg: routeJob.rowType }, t.unit(), (ctx, { arg }) => {
  requireInternal(ctx);
  const snapshot = ctx.withTx(tx => tx.db.dispatchRoute.assignmentId.find(arg.assignmentId));
  if (!snapshot || snapshot.revision !== arg.revision || snapshot.state !== "pending") return {};
  // Maincloud cannot reach a developer's loopback server; the route bridge handles
  // jobs unless a publicly reachable OSMnx service is configured on this module.
  if (!ctx.env.ROUTER_URL) return {};
  let route: ReturnType<typeof parseRoadRoute> | undefined;
  let failureReason: string | undefined;
  try {
    const root = ctx.env.ROUTER_URL;
    const url = `${root.replace(/\/$/, "")}/route/v1/driving/${snapshot.originLng},${snapshot.originLat};${snapshot.destinationLng},${snapshot.destinationLat}?overview=full&geometries=geojson&steps=false`;
    const response = ctx.http.fetch(url, { timeout: TimeDuration.fromMillis(5000), headers: { Accept: "application/json", "User-Agent": "HackUTD-Houston-Demo/1.0" } });
    if (!response.ok) throw new Error(`Routing provider returned HTTP ${response.status}`);
    const raw = response.json() as { source?: string };
    if (raw.source !== "osmnx") throw new Error("Routing provider did not return an OSMnx route");
    route = parseRoadRoute(raw);
  } catch (error) {
    console.error("[routing] native OSMnx fetch failed", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    failureReason = "Routing provider unavailable or no valid road route returned";
  }
  ctx.withTx(tx => commitRoadRoute(tx, snapshot, route, failureReason));
  return {};
});
