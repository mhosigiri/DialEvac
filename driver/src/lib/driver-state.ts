import type { Assignment, Household, Request, Shelter, Vehicle } from "../module_bindings/types";

export interface DriverStop {
  assignmentId: bigint;
  requestId: bigint;
  householdId: bigint;
  residentName: string;
  address: string;
  phone?: string;
  riderId?: string;
  simulated?: boolean;
  people: number;
  mobility: string;
  assistance: string;
  status: "offered" | "accepted" | "en_route" | "arrived" | "completed";
  etaMinutes?: number;
  stopOrder: number;
  lat: number;
  lng: number;
  shelter?: {
    id: bigint;
    name: string;
    lat: number;
    lng: number;
    capacity: number;
  };
}

export function buildDriverStops(
  assignments: readonly Assignment[],
  requests: readonly Request[],
  households: readonly Household[],
  shelters: readonly Shelter[],
  vehicleId?: bigint
): DriverStop[] {
  if (!vehicleId) return [];

  const vehicleAssignments = assignments.filter(
    (a) => a.vehicleId === vehicleId && (a.status === "accepted" || a.status === "en_route")
  );

  const stops: DriverStop[] = [];

  for (const a of vehicleAssignments) {
    const req = requests.find((r) => r.id === a.requestId);
    if (!req || req.status === "closed") continue;

    const home = households.find((h) => h.id === req.householdId);
    if (!home) continue;

    const shelter = a.shelterId !== undefined ? shelters.find((s) => s.id === a.shelterId) : undefined;

    stops.push({
      assignmentId: a.id,
      requestId: req.id,
      householdId: home.id,
      residentName: home.name,
      address: home.address,
      phone: home.simulated ? undefined : home.phone,
      riderId: home.riderId,
      simulated: home.simulated,
      people: req.people || 1,
      mobility: req.mobility || home.mobility || "walks",
      assistance: req.assistance || home.assistance || "none",
      status: a.status as "accepted" | "en_route",
      etaMinutes: req.etaMinutes ?? a.etaMinutes,
      stopOrder: a.stopOrder || 1,
      lat: home.lat,
      lng: home.lng,
      shelter: shelter
        ? {
            id: shelter.id,
            name: shelter.name,
            lat: shelter.lat,
            lng: shelter.lng,
            capacity: shelter.capacity,
          }
        : undefined,
    });
  }

  // Sort by stopOrder ascending
  return stops.sort((a, b) => a.stopOrder - b.stopOrder);
}

export function formatDistance(meters?: number): string {
  if (meters === undefined || meters === null) return "--";
  if (meters < 1000) {
    // Show feet in US standard
    const feet = Math.round(meters * 3.28084);
    return `${feet} ft`;
  }
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return "--";
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "< 1 min";
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  }
  return `${mins} min`;
}

