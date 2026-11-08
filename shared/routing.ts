export type Point = { lat: number; lng: number };

// Compatible road providers can repeat a waypoint in geometry without directions.
// Compare the same path without treating a repeated consecutive vertex as a different road.
export function sameRoadGeometry(a: readonly Point[], b: readonly Point[]) {
  const compact = (points: readonly Point[]) => points.filter((point, index) => !index || point.lat !== points[index - 1].lat || point.lng !== points[index - 1].lng);
  const left = compact(a), right = compact(b);
  return left.length === right.length && left.every((point, index) => point.lat === right[index].lat && point.lng === right[index].lng);
}

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

