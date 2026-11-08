import { parseRoadRoute, type Point } from "../../shared/routing";
import { parseRouteSteps, type RouteStep } from "../../shared/route-guidance";

async function requestRoadRoute(origin: Point, destination: Point, steps: boolean, fetchImpl: typeof fetch) {
  for (const p of [origin, destination]) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 85 || Math.abs(p.lng) > 180) throw new Error("Invalid routing coordinates");
  }
  const root = (process.env.OSMNX_ROUTER_URL || process.env.ROUTER_URL || "http://127.0.0.1:8800").replace(/\/$/, "");
  const url = `${root}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=${steps}`;
  // Cold OpenStreetMap downloads can take longer than a cached route calculation.
  const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "HackUTD-Dispatch-Routing/1.0" }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Routing provider unavailable (OSMnx HTTP ${response.status})`);
  const raw = await response.json();
  if (raw?.code === "Ok" && raw.source !== "osmnx") throw new Error("Routing provider did not return an OSMnx route");
  return { raw, route: parseRoadRoute(raw) };
}

export async function fetchRoadRoute(origin: Point, destination: Point, fetchImpl: typeof fetch = fetch) {
  return (await requestRoadRoute(origin, destination, false, fetchImpl)).route;
}

export async function fetchRoadDirections(origin: Point, destination: Point, fetchImpl: typeof fetch = fetch) {
  const { raw, route } = await requestRoadRoute(origin, destination, true, fetchImpl);
  const steps: RouteStep[] = (raw.routes[0].legs ?? []).flatMap((leg: { steps?: { name?: string; distance: number; duration: number; maneuver: { type: string; modifier?: string; exit?: number; location: number[] } }[] }) =>
    (leg.steps ?? []).map(step => {
      const road = String(step.name ?? "").slice(0, 180), maneuver = step.maneuver;
      const action = maneuver.type === "arrive" ? "Arrive at the destination" : maneuver.type === "depart" ? "Depart" : maneuver.type.replace(/_/g, " ");
      const instruction = `${action.charAt(0).toUpperCase()}${action.slice(1)}${maneuver.modifier && maneuver.type !== "depart" ? ` ${maneuver.modifier === "uturn" ? "with a U-turn" : maneuver.modifier}` : ""}${maneuver.exit ? `, exit ${maneuver.exit}` : ""}${road ? ` on ${road}` : ""}`;
      return { instruction, road, distanceMeters: step.distance, durationSeconds: step.duration, lat: maneuver.location[1], lng: maneuver.location[0] };
    }));
  if (!steps.length) throw new Error("Routing provider returned no driving directions");
  return { ...route, steps: parseRouteSteps(steps) };
}
