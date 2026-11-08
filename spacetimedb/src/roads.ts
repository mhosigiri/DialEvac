import { SenderError, t } from "spacetimedb/server";
import { spacetimedb } from "./schema";
import { audit, type Tx } from "./core";
import { requestReplan } from "./dispatch";

// Closures from the feed poller, drivers, residents and the manual control. Any change bumps the
// road version, and the dispatcher re-plans at once.

export function upsertClosure(tx: Tx, closure: { externalId: string; source: string; street: string; lat: number; lng: number; active: boolean }) {
  const existing = tx.db.roadClosure.externalId.find(closure.externalId);
  if (existing && existing.active === closure.active) return false;
  if (existing) tx.db.roadClosure.id.update({ ...existing, ...closure, at: tx.timestamp });
  else tx.db.roadClosure.insert({ id: 0n, ...closure, at: tx.timestamp });
  audit(tx, "road", `${closure.street} ${closure.active ? "closed" : "reopened"} (${closure.source})`);
  return true;
}

export function bumpRoads(tx: Tx) {
  const state = tx.db.dispatchState.id.find(0);
  if (state) tx.db.dispatchState.id.update({ ...state, roadVersion: state.roadVersion + 1n });
  requestReplan(tx, true);
}

export const closeRoad = spacetimedb.reducer(
  { externalId: t.string(), source: t.string(), street: t.string(), lat: t.f64(), lng: t.f64() },
  (ctx, closure) => {
    if (!["manual", "driver", "resident", "feed"].includes(closure.source)) throw new SenderError(`unknown closure source ${closure.source}`);
    if (upsertClosure(ctx, { ...closure, active: true })) bumpRoads(ctx);
  },
);

export const reopenRoad = spacetimedb.reducer({ externalId: t.string() }, (ctx, { externalId }) => {
  const existing = ctx.db.roadClosure.externalId.find(externalId);
  if (!existing) throw new SenderError("no such closure");
  if (upsertClosure(ctx, { ...existing, active: false })) bumpRoads(ctx);
});
