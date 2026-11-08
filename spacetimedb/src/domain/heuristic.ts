import type { PlannedStop, Problem, ProblemRequest, Solution } from "./problem";

// The fallback dispatcher when the solver service is down or unset: earliest deadline first (riders
// who lost a driver go first), each rider to the compatible vehicle that reaches them soonest, one
// household per trip to the nearest shelter with room. dispatch/heuristic.py is the solver
// service's competent heuristic, which also packs trips; this one only has to be safe.

const UNLOAD_SECONDS = 120;

type VehicleClock = { location: number; at: number };

function order(a: ProblemRequest, b: ProblemRequest) {
  if (Boolean(a.reassigned) !== Boolean(b.reassigned)) return a.reassigned ? -1 : 1;
  return a.deadline - b.deadline;
}

function fits(problem: Problem, vehicle: number, request: ProblemRequest) {
  const v = problem.vehicles[vehicle];
  return (
    v.seats >= request.load.seats &&
    v.wheelchairSpaces >= request.load.wheelchairSpaces &&
    v.stretcherSpaces >= request.load.stretcherSpaces
  );
}

function nearestShelter(problem: Problem, from: number, room: number[], people: number) {
  let best: { index: number; seconds: number } | null = null;
  problem.shelters.forEach((shelter, index) => {
    const seconds = problem.matrix[from][shelter.location];
    if (seconds === null || room[index] < people) return;
    if (!best || seconds < best.seconds) best = { index, seconds };
  });
  return best as { index: number; seconds: number } | null;
}

export function solveHeuristic(problem: Problem): Solution {
  const started = Date.now();
  const clocks: VehicleClock[] = problem.vehicles.map((v) => ({ location: v.location, at: v.availableAt }));
  const stops: PlannedStop[][] = problem.vehicles.map(() => []);
  const room = problem.shelters.map((s) => s.capacity);
  const dropped: string[] = [];

  for (const request of [...problem.requests].sort(order)) {
    const people = request.load.seats + request.load.wheelchairSpaces + request.load.stretcherSpaces;
    let best: { vehicle: number; pickup: number; shelter: number; dropoff: number } | null = null;
    for (const vehicle of request.allowedVehicles) {
      if (!fits(problem, vehicle, request)) continue;
      const clock = clocks[vehicle];
      const toRider = problem.matrix[clock.location][request.location];
      if (toRider === null) continue;
      const pickup = clock.at + toRider;
      const shelter = nearestShelter(problem, request.location, room, people);
      if (!shelter) continue;
      const dropoff = pickup + request.boardingSeconds + shelter.seconds;
      if (dropoff > problem.vehicles[vehicle].endBy) continue;
      if (!best || pickup < best.pickup) best = { vehicle, pickup, shelter: shelter.index, dropoff };
    }
    if (!best) {
      dropped.push(request.id);
      continue;
    }
    const shelter = problem.shelters[best.shelter];
    stops[best.vehicle].push(
      { request: request.id, kind: "pickup", shelter: null, arrival: best.pickup },
      { request: request.id, kind: "dropoff", shelter: shelter.id, arrival: best.dropoff },
    );
    clocks[best.vehicle] = { location: shelter.location, at: best.dropoff + UNLOAD_SECONDS };
    room[best.shelter] -= people;
  }

  return {
    routes: problem.vehicles.map((v, i) => ({ vehicle: v.id, stops: stops[i] })).filter((r) => r.stops.length > 0),
    dropped,
    solver: "heuristic",
    solveMs: Date.now() - started,
  };
}
