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

// Wildfire (and other radial hazards) keep the control-record defaults. Tornado is faster and
// closer: isolate its lead time here so issueWarning/startNight does not reuse wildfire numbers.
export const TORNADO_TIMING = { firstArrivalMinutes: 8, metersPerMinute: 800 } as const;
export const WILDFIRE_DOOR_CHECK_LEAD_MINUTES = 25;
export const TORNADO_DOOR_CHECK_LEAD_MINUTES = 4;

export function timingForHazard(hazard: string): { firstArrivalMinutes: number; metersPerMinute: number } | undefined {
  if (hazard === "tornado") return { firstArrivalMinutes: TORNADO_TIMING.firstArrivalMinutes, metersPerMinute: TORNADO_TIMING.metersPerMinute };
  return undefined;
}

export function doorCheckLeadMinutes(hazard: string) {
  return hazard === "tornado" ? TORNADO_DOOR_CHECK_LEAD_MINUTES : WILDFIRE_DOOR_CHECK_LEAD_MINUTES;
}

// Riders must be aboard this long before the hazard arrives.
export const DEADLINE_MARGIN_MINUTES = 10;
