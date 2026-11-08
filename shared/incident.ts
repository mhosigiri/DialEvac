export type IncidentPoint = { lat: number; lng: number };
export const validIncidentPoint = (point: IncidentPoint) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

export function validateZone(value: unknown): [number, number][][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error("Use a polygon with 1–10 rings");
  for (const ring of value) {
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > 501) throw new Error("Each boundary needs 3–500 corners and a closing coordinate");
    if (!ring.every(p => Array.isArray(p) && p.length === 2 && validIncidentPoint({ lng: p[0], lat: p[1] }))) throw new Error("Boundary coordinates must be valid longitude/latitude pairs");
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) throw new Error("The boundary must be closed");
    const unique = new Set(ring.slice(0, -1).map(p => p.join(",")));
    if (unique.size !== ring.length - 1) throw new Error("Boundary corners must be distinct");
    const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const on = (a: number[], b: number[], p: number[]) => cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
    for (let i = 0; i < ring.length - 1; i++) for (let j = i + 2; j < ring.length - 1; j++) {
      if (i === 0 && j === ring.length - 2) continue;
      const [a, b, c, d] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0 || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) throw new Error("Boundary lines must not cross or touch themselves");
    }
    const area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
    if (Math.abs(area) < 1e-12) throw new Error("The boundary must enclose an area");
  }
  return value as [number, number][][];
}

export const ringsForPoints = (points: readonly IncidentPoint[]) => validateZone([[...points.map(p => [p.lng, p.lat]), [points[0]?.lng, points[0]?.lat]]]);

export type RiderImport = { riderId: string; name: string; address: string; lat: number; lng: number; phone: string; language: string; mobility: string; assistance: string; people?: number; oxygen?: boolean; needProbability?: number };
export const fictionalContact = (phone: string) => /^\+1\d{3}555\d{4}$/.test(phone);
export function validateRider(row: RiderImport) {
  if (!row.riderId?.trim() || row.riderId.length > 150 || !row.name?.trim() || row.name.length > 200 || !row.address?.trim() || row.address.length > 500) throw new Error("Rider ID, name and address are required (150/200/500 character limits)");
  if (!validIncidentPoint(row)) throw new Error("Latitude/longitude are invalid");
  if (!/^\+[1-9]\d{7,14}$/.test(row.phone)) throw new Error("Phone must use E.164 format, such as +18325550100");
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(row.language)) throw new Error("Use a language code such as en or es");
  if (!["walks", "walker", "wheelchair", "bedbound"].includes(row.mobility) || !["none", "one_person", "two_person_lift"].includes(row.assistance)) throw new Error("Unknown mobility or assistance value");
  if (row.people !== undefined && (!Number.isInteger(row.people) || row.people < 1 || row.people > 49)) throw new Error("People must be a whole number from 1 to 49");
  if (row.oxygen !== undefined && typeof row.oxygen !== "boolean") throw new Error("Oxygen must be true or false");
  if (row.needProbability !== undefined && (!Number.isFinite(row.needProbability) || row.needProbability < 0 || row.needProbability > 1)) throw new Error("Need probability must be between 0 and 1");
}
