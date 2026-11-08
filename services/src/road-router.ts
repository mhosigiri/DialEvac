import { parseRoadRoute, type Point } from "../../shared/routing";
import { parseRouteSteps, type RouteStep } from "../../shared/route-guidance";

export async function fetchRoadRoute(origin: Point, destination: Point, fetchImpl: typeof fetch = fetch) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
  const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "HackUTD-Houston-Demo/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Routing provider unavailable");
  return parseRoadRoute(await response.json());
}

export async function fetchRoadDirections(origin: Point, destination: Point, fetchImpl: typeof fetch = fetch) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;
  const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "HackUTD-Houston-Demo/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Routing provider unavailable");
  const raw = await response.json();
  const route = parseRoadRoute(raw);
  const steps: RouteStep[] = (raw.routes[0].legs ?? []).flatMap((leg: { steps?: { name?: string; distance: number; duration: number; maneuver: { type: string; modifier?: string; exit?: number; location: number[] } }[] }) =>
    (leg.steps ?? []).map(step => {
      const road = String(step.name ?? "").slice(0, 180), maneuver = step.maneuver;
      const action = maneuver.type === "arrive" ? "Arrive at the destination" : maneuver.type === "depart" ? "Depart" : maneuver.type.replace(/_/g, " ");
      const instruction = `${action.charAt(0).toUpperCase()}${action.slice(1)}${maneuver.modifier ? ` ${maneuver.modifier}` : ""}${maneuver.exit ? `, exit ${maneuver.exit}` : ""}${road ? ` on ${road}` : ""}`;
      return { instruction, road, distanceMeters: step.distance, durationSeconds: step.duration, lat: maneuver.location[1], lng: maneuver.location[0] };
    }));
  if (!steps.length) throw new Error("Routing provider returned no driving directions");
  return { ...route, steps: parseRouteSteps(steps) };
}
