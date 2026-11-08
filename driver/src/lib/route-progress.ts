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
  const passes: typeof hits = [];
  hits.forEach((hit, i) => {
    if (hit.offMeters > limit) return;
    const continuesPass = i > 0 && hits[i - 1].offMeters <= limit;
    if (!continuesPass) passes.push(hit);
    else if (hit.offMeters < passes[passes.length - 1].offMeters) passes[passes.length - 1] = hit;
  });
  return passes.reduce((best, pass) => (Math.abs(pass.meters - expectedMeters) <= Math.abs(best.meters - expectedMeters) ? pass : best)).meters;
}

// `previousMeters` is the last known progress, which tells the passes of a doubled-back road apart.
export function followRoute(path: readonly Point[], steps: readonly RouteStep[], position: Point, previousMeters: number) {
  const drivenMeters = metersAlong(path, position, previousMeters);
  const starts: number[] = [];
  steps.forEach((step, i) => starts.push(metersAlong(path, step, i ? starts[i - 1] + steps[i - 1].distanceMeters : 0)));
  const stepIndex = Math.max(0, starts.reduce((last, start, i) => (start - TURN_LEAD_METERS <= drivenMeters ? i : last), 0));
  const nextStart = starts[stepIndex + 1];
  return { drivenMeters, stepIndex, metersToNextStep: nextStart === undefined ? undefined : Math.max(0, nextStart - drivenMeters) };
}
