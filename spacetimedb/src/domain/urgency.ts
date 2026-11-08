import type { Mobility } from "./need";

// Who to reach and help first when there are more people than phone lines and vehicles.
// Time left before the hazard decides first: a home with 20 minutes is called before a home with
// three hours, whatever their needs. Within the same window, people who can't leave on their own
// go first. needProbability is the prior from records (a medical registry, a policy file) before
// anyone has been asked.

const WINDOWS_MINUTES = [120, 60, 30] as const;
const MOBILITY_WEIGHT: Record<Mobility, number> = { walks: 0, walker: 1, wheelchair: 2, bedbound: 3 };

export type UrgencyInputs = { minutesLeft: number; mobility: Mobility; oxygen: boolean; people: number; needProbability: number };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// Higher is more urgent. Windows are 100 apart and everything inside one sums below 100, so a
// tighter window always outranks needs.
export function urgency({ minutesLeft, mobility, oxygen, people, needProbability }: UrgencyInputs) {
  const window = WINDOWS_MINUTES.filter((limit) => minutesLeft < limit).length;
  const vulnerability = MOBILITY_WEIGHT[mobility] + (oxygen ? 2 : 0) + clamp(people, 0, 6) / 3 + 3 * clamp(needProbability, 0, 1);
  const sooner = 1 - clamp(minutesLeft, 0, 240) / 240;
  return window * 100 + vulnerability * 9 + sooner * 9;
}
