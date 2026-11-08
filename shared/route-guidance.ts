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

export function routeMatchesLocations(route: { originLat: number; originLng: number; destinationLat: number; destinationLng: number }, origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
  return route.originLat === origin.lat && route.originLng === origin.lng && route.destinationLat === destination.lat && route.destinationLng === destination.lng;
}

export function drivingDirectionsUrl(origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) {
  const query = new URLSearchParams({ api: "1", origin: `${origin.lat},${origin.lng}`, destination: `${destination.lat},${destination.lng}`, travelmode: "driving" });
  return `https://www.google.com/maps/dir/?${query}`;
}
