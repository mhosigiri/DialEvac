import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { DbConnection } from "../src/module_bindings";
import { SPACETIME_URI, SPACETIME_DATABASE, SPACETIME_DEMO_DATABASE, databaseHost, separateDemoDatabase } from "../../shared/spacetime";

export async function houstonConnection() {
  const uri = process.env.SPACETIME_SIMULATION_URI || SPACETIME_URI, database = process.env.SPACETIME_SIMULATION_DATABASE || SPACETIME_DEMO_DATABASE;
  assert(separateDemoDatabase(uri, database, SPACETIME_URI, SPACETIME_DATABASE), "Operational database is forbidden");
  assert(databaseHost(uri) !== databaseHost(SPACETIME_URI) || database === SPACETIME_DEMO_DATABASE, "Only the approved remote demo may be used");
  let token = process.env.SPACETIME_DEMO_OPERATOR_TOKEN;
  const persisted = new URL("../../.spacetime/demo-auth.json", import.meta.url);
  if (!token && existsSync(persisted)) token = JSON.parse(readFileSync(persisted, "utf8")).operator?.token;
  assert(token, "Supply an existing granted SPACETIME_DEMO_OPERATOR_TOKEN; this command never grants identities");
  return new Promise<DbConnection>((resolve, reject) => {
    const timer = setTimeout(() => { c.disconnect(); reject(new Error("Demo connection timed out")); }, 15_000);
    const c = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect(conn => conn.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(conn); }).onError(ctx => { clearTimeout(timer); conn.disconnect(); reject(ctx.event); })
        .subscribe(["household", "call", "transcript_line", "request", "vehicle", "assignment", "message", "zone", "coverage", "catastrophe_case", "follow_up", "dispatch_route"].map(t => `SELECT * FROM ${t}`)))
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(error); }).build();
  });
}
