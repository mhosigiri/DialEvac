import { parseRoadRoute, type Point } from "../../shared/routing";

export async function fetchRoadRoute(origin: Point, destination: Point, fetchImpl: typeof fetch = fetch) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
  const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "HackUTD-Houston-Demo/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Routing provider unavailable");
  return parseRoadRoute(await response.json());
}
