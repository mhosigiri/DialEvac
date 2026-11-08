import type { Household, Request } from "../module_bindings/types";
import { buildCases } from "./cases";

// Compatibility for committed portal components until their owner lands the cases.ts migration.
export function generateEmergencySummary(household: Household, request?: Request) {
  const [{ summary, urgency }] = buildCases({ households: [household], requests: request ? [request] : [], vehicles: [], assignments: [], calls: [] });
  return { summary, urgency };
}
