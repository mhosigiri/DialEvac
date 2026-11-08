type Point = { lat: number; lng: number };

// `p` against the segment a-b, on a flat projection around `a` (fine across a town).
export function projectOntoSegment(p: Point, a: Point, b: Point) {
  const k = Math.cos((a.lat * Math.PI) / 180);
  const toXY = (q: Point) => [(q.lng - a.lng) * k * 111_320, (q.lat - a.lat) * 110_540] as const;
  const [px, py] = toXY(p);
  const [bx, by] = toXY(b);
  const lengthSquared = bx * bx + by * by;
  const s = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared));
  const lengthMeters = Math.sqrt(lengthSquared);
  return { offMeters: Math.hypot(px - s * bx, py - s * by), alongMeters: s * lengthMeters, lengthMeters };
}

export function metersToSegment(p: Point, a: Point, b: Point) {
  return projectOntoSegment(p, a, b).offMeters;
}
