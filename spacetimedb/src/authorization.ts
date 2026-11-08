import { SenderError, type ReducerCtx } from "spacetimedb/server";
import type { Schema } from "./core";

type Caller = Pick<ReducerCtx<Schema>, "sender" | "databaseIdentity">;
type AuthorizedContext = Caller & Pick<ReducerCtx<Schema>, "env">;

export function requireInternal(ctx: Caller) {
  if (!ctx.sender.isEqual(ctx.databaseIdentity)) throw new SenderError("Only the database may invoke scheduled/internal work");
}

function granted(ctx: AuthorizedContext, key: "OPERATOR_IDENTITIES" | "SERVICE_IDENTITIES") {
  const sender = ctx.sender.toHexString().toLowerCase();
  return (ctx.env[key] ?? "").split(",").some(value => {
    const identity = value.trim().toLowerCase().replace(/^0x/, "");
    return /^[0-9a-f]{64}$/.test(identity) && identity === sender;
  });
}

export function requireOperator(ctx: AuthorizedContext) {
  if (ctx.sender.isEqual(ctx.databaseIdentity)) return;
  if (!granted(ctx, "OPERATOR_IDENTITIES")) throw new SenderError("Not authorized: operator identity required");
}

export function requireService(ctx: AuthorizedContext) {
  if (ctx.sender.isEqual(ctx.databaseIdentity)) return;
  if (!granted(ctx, "SERVICE_IDENTITIES")) throw new SenderError("Not authorized: service identity required");
}

export function requireRecordEditor(ctx: AuthorizedContext) {
  if (ctx.sender.isEqual(ctx.databaseIdentity)) return;
  if (!granted(ctx, "OPERATOR_IDENTITIES") && !granted(ctx, "SERVICE_IDENTITIES")) throw new SenderError("Not authorized: operator or service identity required");
}
