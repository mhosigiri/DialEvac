import { projectOntoSegment } from "../../../shared/geo";
import type { RouteStep } from "../../../shared/route-guidance";

type Point = { lat: number; lng: number };

const SAME_ROAD_METERS = 30;
const TURN_LEAD_METERS = 50;

// A route can pass one spot more than once, so each separate pass near the point is a candidate
// and the one closest to where the responder is expected to be wins.
function metersAlong(path: readonly Point[], point: Point, expectedMeters: number) {
  let walked = 0;
  const hits = path.slice(1).map((end, i) => {
    const { offMeters, alongMeters, lengthMeters } = projectOntoSegment(point, path[i], end);
    const hit = { offMeters, meters: walked + alongMeters };
    walked += lengthMeters;
    return hit;
  });
  const limit = Math.min(...hits.map((hit) => hit.offMeters)) + SAME_ROAD_METERS;
  const near = hits.filter((hit) => hit.offMeters <= limit);
  const passes: typeof hits = [];
  near.forEach((hit, i) => {
    if (!i || hit.meters - near[i - 1].meters > 2 * SAME_ROAD_METERS) passes.push(hit);
    else if (hit.offMeters < passes[passes.length - 1].offMeters) passes[passes.length - 1] = hit;
  });
  return passes.reduce((best, pass) => (Math.abs(pass.meters - expectedMeters) <= Math.abs(best.meters - expectedMeters) ? pass : best)).meters;
}

// `previousMeters` is the last known progress, which tells the passes of a doubled-back road apart.
export function followRoute(path: readonly Point[], steps: readonly RouteStep[], position: Point, previousMeters: number) {
  const drivenMeters = metersAlong(path, position, previousMeters);
  const starts: number[] = [];
  steps.forEach((step, i) => starts.push(metersAlong(path, step, i ? starts[i - 1] + steps[i - 1].distanceMeters : 0)));
  // The lead stays under half of the road before the turn, so a short road still gets its own instruction.
  const stepIndex = starts.reduce((last, start, i) => (i && start - Math.min(TURN_LEAD_METERS, steps[i - 1].distanceMeters / 2) <= drivenMeters ? i : last), 0);
  const stepMeters = steps[stepIndex]?.distanceMeters ?? 0;
  return { drivenMeters, stepIndex, metersLeftOnStep: Math.max(0, stepMeters - Math.max(0, drivenMeters - starts[stepIndex])) };
}
