import type { Household, Vehicle, Request } from "../module_bindings/types";
import { needsOf, vehicleCanServe as serverVehicleCanServe } from "../../../spacetimedb/src/domain/need";

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Calculates Haversine distance between two coordinates in miles.
 */
export function haversineDistanceMiles(a: GeoPoint, b: GeoPoint): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDlat = Math.sin(dLat / 2);
  const sinDlng = Math.sin(dLng / 2);
  const aVal = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlng * sinDlng;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
}

/**
 * Estimated driving time in minutes assuming 25 mph city disaster response speed.
 */
export function estimateDriveMinutes(distanceMiles: number): number {
  const speedMph = 25;
  const minutes = (distanceMiles / speedMph) * 60;
  return Math.max(1, Math.round(minutes));
}

/**
 * Checks if a rescue vehicle has the physical capacity and crew to serve a victim's needs.
 */
export function vehicleCanServe(
  vehicle: Vehicle,
  request: Pick<Request, "people" | "mobility" | "oxygen" | "assistance">
): boolean {
  return serverVehicleCanServe(vehicle, needsOf(request));
}

export interface DispatcherProximityMatch {
  vehicle: Vehicle;
  distanceMiles: number;
  etaMinutes: number;
  canServe: boolean;
  score: number; // lower is better
}

/**
 * Computes proximity and suitability edges in the bipartite dispatch graph
 * between a victim household and all rescue vehicles.
 */
export function findClosestDispatchers(
  victim: Household,
  request: Request | undefined,
  vehicles: readonly Vehicle[]
): DispatcherProximityMatch[] {
  const matches: DispatcherProximityMatch[] = [];

  for (const vehicle of vehicles) {
    const dist = haversineDistanceMiles(
      { lat: victim.lat, lng: victim.lng },
      { lat: vehicle.lat, lng: vehicle.lng }
    );
    const eta = estimateDriveMinutes(dist);

    const canServe = request ? vehicleCanServe(vehicle, request) : true;
    // Penalty score: prioritizes capable units, then shortest distance
    const score = dist + (canServe ? 0 : 100);

    matches.push({
      vehicle,
      distanceMiles: Math.round(dist * 10) / 10,
      etaMinutes: eta,
      canServe,
      score,
    });
  }

  // Sort by score ascending (capable and closest first)
  return matches.sort((a, b) => a.score - b.score);
}

/**
 * Parses GeoJSON polygon string rings into [lat, lng] array suitable for Leaflet Polygon.
 */
export function parsePolygonRings(ringsJson: string): [number, number][] {
  try {
    const parsed = JSON.parse(ringsJson);
    // Rings are typically [[[lng, lat], ...]]
    const ring = Array.isArray(parsed[0]) && Array.isArray(parsed[0][0]) ? parsed[0] : parsed;
    return ring.map(([lng, lat]: [number, number]) => [lat, lng]);
  } catch (err) {
    console.error("Failed to parse polygon rings:", err);
    return [];
  }
}
