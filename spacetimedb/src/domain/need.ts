// What a household needs to get out, and whether a vehicle can carry it. The solver's need
// weights (dispatch/fatality.py) and boarding times follow the same table.

export const MOBILITIES = ["walks", "walker", "wheelchair", "bedbound"] as const;
export type Mobility = (typeof MOBILITIES)[number];

export const ASSISTANCE = ["none", "one_person", "two_person_lift"] as const;
export type Assistance = (typeof ASSISTANCE)[number];

export type Load = { seats: number; wheelchairSpaces: number; stretcherSpaces: number };

export type Needs = { people: number; mobility: Mobility; assistance: Assistance; oxygen: boolean };

export type VehicleFit = Load & { crew: number; lift: boolean };

const BOARDING_SECONDS: Record<Mobility, number> = { walks: 120, walker: 300, wheelchair: 600, bedbound: 1200 };

export function isMobility(value: string): value is Mobility {
  return (MOBILITIES as readonly string[]).includes(value);
}

export function isAssistance(value: string): value is Assistance {
  return (ASSISTANCE as readonly string[]).includes(value);
}

export function loadFor({ people, mobility }: Needs): Load {
  const others = Math.max(0, people - 1);
  if (mobility === "wheelchair") return { seats: others, wheelchairSpaces: 1, stretcherSpaces: 0 };
  if (mobility === "bedbound") return { seats: others, wheelchairSpaces: 0, stretcherSpaces: 1 };
  return { seats: Math.max(1, people), wheelchairSpaces: 0, stretcherSpaces: 0 };
}

export function crewFor({ assistance, mobility }: Needs) {
  if (assistance === "two_person_lift" || mobility === "bedbound") return 2;
  return 1;
}

export function liftFor({ mobility }: Needs) {
  return mobility === "wheelchair" || mobility === "bedbound";
}

export function boardingSecondsFor(needs: Needs) {
  return needs.assistance === "two_person_lift" ? BOARDING_SECONDS.bedbound : BOARDING_SECONDS[needs.mobility];
}

// 1 can walk, 3 needs an accessible vehicle, +1 for a lift or oxygen.
export function weightFor(needs: Needs) {
  const base = liftFor(needs) ? 3 : 1;
  return base + (needs.assistance === "two_person_lift" ? 1 : 0) + (needs.oxygen ? 1 : 0);
}

export function vehicleCanServe(vehicle: VehicleFit, needs: Needs) {
  const load = loadFor(needs);
  return (
    vehicle.seats >= load.seats &&
    vehicle.wheelchairSpaces >= load.wheelchairSpaces &&
    vehicle.stretcherSpaces >= load.stretcherSpaces &&
    vehicle.crew >= crewFor(needs) &&
    (vehicle.lift || !liftFor(needs))
  );
}
