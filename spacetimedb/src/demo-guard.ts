import { SenderError, type ReducerCtx } from "spacetimedb/server";
import { CONTROL_ID, type Schema } from "./core";

// Module environment can only be changed by a publisher. Browser parameters cannot enable this.
export function requireDemoDatabase(ctx: Pick<ReducerCtx<Schema>, "db" | "env">) {
  if (ctx.env.DEMO_MODE !== "isolated") throw new SenderError("Demo operations are disabled on this database");
  if ([...ctx.db.household.iter()].some(home => !home.simulated) || [...ctx.db.vehicle.iter()].some(vehicle => !vehicle.simulated)) {
    throw new SenderError("Demo operations require a database containing only simulated households and vehicles");
  }
  if (ctx.db.control.id.find(CONTROL_ID)?.warningAt) {
    throw new SenderError("An incident is active; use a separate demo database");
  }
}
