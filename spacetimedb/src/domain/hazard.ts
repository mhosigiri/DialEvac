import { metersBetween, type Point } from "./geo";

export const HAZARDS = ["wildfire", "flood", "hurricane", "tornado", "earthquake"] as const;
export type Hazard = (typeof HAZARDS)[number];

export function isHazard(value: string): value is Hazard {
  return (HAZARDS as readonly string[]).includes(value);
}

// A stand-in hazard: it reaches the origin `firstArrivalMinutes` after the warning and spreads
// outward at a fixed speed. A scenario file replaces it per city.
export type RadialHazard = { origin: Point; firstArrivalMinutes: number; metersPerMinute: number };

export function minutesUntilHazard(home: Point, hazard: RadialHazard) {
  return hazard.firstArrivalMinutes + metersBetween(home, hazard.origin) / hazard.metersPerMinute;
}

// Riders must be aboard this long before the hazard arrives.
export const DEADLINE_MARGIN_MINUTES = 10;
