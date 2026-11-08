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

// Meters from `p` to the segment a-b, on a flat projection around `a` (fine across a town).
export function metersToSegment(p: Point, a: Point, b: Point) {
  const k = Math.cos((a.lat * Math.PI) / 180);
  const toXY = (q: Point) => [(q.lng - a.lng) * k * 111_320, (q.lat - a.lat) * 110_540] as const;
  const [px, py] = toXY(p);
  const [bx, by] = toXY(b);
  const lengthSquared = bx * bx + by * by;
  const s = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
  return Math.hypot(px - s * bx, py - s * by);
}
