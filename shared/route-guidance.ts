import { metersToSegment } from "./geo";

export type RouteStep = { instruction: string; road: string; distanceMeters: number; durationSeconds: number; lat: number; lng: number };

export function parseRouteSteps(value: unknown): RouteStep[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Invalid route directions");
  return value.map(step => {
    if (!step || typeof step.instruction !== "string" || !step.instruction.trim() || step.instruction.length > 500 || typeof step.road !== "string" || step.road.length > 180 ||
      !Number.isFinite(step.distanceMeters) || step.distanceMeters < 0 || !Number.isFinite(step.durationSeconds) || step.durationSeconds < 0 ||
      !Number.isFinite(step.lat) || Math.abs(step.lat) > 90 || !Number.isFinite(step.lng) || Math.abs(step.lng) > 180) throw new Error("Invalid route directions");
    return { instruction: step.instruction, road: step.road, distanceMeters: step.distanceMeters, durationSeconds: step.durationSeconds, lat: step.lat, lng: step.lng };
  });
}

const ON_ROUTE_METERS = 250;

// A route stays valid while the responder drives it, so only leaving it or a moved pickup invalidates it.
// Requested endpoints join the path because the road network may snap them up to 1 km from the geometry.
export function routeMatchesLocations(
  route: { originLat: number; originLng: number; destinationLat: number; destinationLng: number; points: readonly { lat: number; lng: number }[] },
  responder: { lat: number; lng: number },
  destination: { lat: number; lng: number },
) {
  if (route.destinationLat !== destination.lat || route.destinationLng !== destination.lng) return false;
  const origin = { lat: route.originLat, lng: route.originLng };
  const path = route.points.length ? [origin, ...route.points, destination] : [origin, origin];
  return path.slice(1).some((point, i) => metersToSegment(responder, path[i], point) <= ON_ROUTE_METERS);
}
