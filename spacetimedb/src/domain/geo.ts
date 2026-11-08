export type Point = { lat: number; lng: number };

const EARTH_METERS = 6_371_000;

export function metersBetween(a: Point, b: Point) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_METERS * Math.asin(Math.sqrt(h));
}

// Straight-line distance stretched by a street detour factor at town driving speed. Stands in for
// the road graph until one is loaded for the city.
const DETOUR = 1.35;
const METERS_PER_SECOND = 11;

export function driveSeconds(a: Point, b: Point) {
  return Math.round((metersBetween(a, b) * DETOUR) / METERS_PER_SECOND);
}

// Ray casting over a ring of [lng, lat] pairs, the GeoJSON order.
export function insideRing(point: Point, ring: readonly (readonly [number, number])[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function insidePolygon(point: Point, rings: readonly (readonly (readonly [number, number])[])[]) {
  const [outer, ...holes] = rings;
  return outer !== undefined && insideRing(point, outer) && !holes.some((hole) => insideRing(point, hole));
}

export { metersToSegment } from "../../../shared/geo";

// Where a vehicle is after driving `driven` meters along `path`, and how far it has left to go.
export function progressAlong(path: readonly Point[], driven: number) {
  const lengths = path.slice(1).map((point, i) => metersBetween(path[i], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let left = Math.max(0, driven);
  for (const [i, length] of lengths.entries()) {
    if (left < length) {
      const s = left / length, [a, b] = [path[i], path[i + 1]];
      return { point: { lat: a.lat + (b.lat - a.lat) * s, lng: a.lng + (b.lng - a.lng) * s }, remainingMeters: total - Math.max(0, driven) };
    }
    left -= length;
  }
  return { point: path[path.length - 1], remainingMeters: 0 };
}
