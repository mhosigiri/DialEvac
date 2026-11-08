import { spacetimedb } from "./schema";
import { requireOperator } from "./authorization";
import { requireDemoDatabase } from "./demo-guard";

// Display copy only. Keep fixture flags, identifiers, contacts and workflow state intact.
const cleanCopy = (text: string) => text
  .replace(/Simulated Houston shelter/g, "Houston shelter")
  .replace(/None reported in simulation/g, "None reported")
  .replace(/Yes, in this simulation/g, "Yes")
  .replace(/ requested in simulation/g, " requested")
  .replace(/Simulated text only; no real sends/g, "Text message")
  .replace(/ \(synthetic\)/g, "");

export const normalizeFixtureLabels = spacetimedb.reducer(ctx => {
  requireOperator(ctx);
  requireDemoDatabase(ctx);
  for (const home of ctx.db.household.iter()) {
    let name = home.name.replace(/^Demo household/i, "Household").replace(/^Simulated home/i, "Household").replace(/\s*· demo$/i, "");
    let address = home.address.replace(/Stand-in St/g, "Greenhaven Dr");
    if (home.riderId === "demo-houston-anish") { name = "Anish"; address = "Buffalo Bayou, Houston, TX"; }
    if (home.riderId === "sim-tornado-wheelchair") name = "Tornado Ave household";
    if (/^Simulated (hurricane|flood|wildfire) (household|resident)/.test(home.name)) {
      const area = home.name.includes("hurricane") ? "Buffalo Bayou hurricane" : home.name.includes("flood") ? "Houston flood" : "Houston fire";
      name = `${area} household`; address = `${area} area, Houston, TX`;
    }
    if (name !== home.name || address !== home.address) ctx.db.household.id.update({ ...home, name, address });
  }
  for (const unit of ctx.db.vehicle.iter()) {
    const name = unit.name.replace("Historical demo", "Houston").replace("Houston demo", "Houston");
    const driverName = unit.driverName.replace("Demo medical dispatcher", "Medical dispatch").replace("Demo dispatcher", "Rescue dispatch").replace("Demo responder", "Response team");
    if (name !== unit.name || driverName !== unit.driverName) ctx.db.vehicle.id.update({ ...unit, name, driverName });
  }
  for (const shelter of ctx.db.shelter.iter()) {
    if (shelter.name === "Stand-in shelter") ctx.db.shelter.id.update({ ...shelter, name: "Richardson community shelter" });
  }
  for (const zone of ctx.db.zone.iter()) {
    if (zone.externalId === "sim-tornado") {
      ctx.db.zone.id.update({ ...zone, name: "Richardson tornado warning", headline: "Tornado warning near UTD" });
    } else if (zone.externalId === "demo-houston-history-2017") {
      ctx.db.zone.id.update({ ...zone, headline: "Flood report locations and household assistance coverage" });
    } else if (zone.externalId.startsWith("demo-houston-")) {
      const event = zone.event.replace(/ demo$/, "");
      ctx.db.zone.id.update({ ...zone, event, name: zone.name === "Houston simulation" ? `Houston ${event}` : zone.name,
        severity: zone.severity === "Simulated" ? "Unspecified" : zone.severity,
        headline: `${zone.name === "Houston simulation" ? `Houston ${event}` : zone.name} response area` });
    }
  }
  for (const followUp of ctx.db.followUp.iter()) {
    if (!followUp.simulated) continue;
    ctx.db.followUp.householdId.update({ ...followUp,
      questions: followUp.questions.map(question => ({ ...question, answer: cleanCopy(question.answer) })),
      changesJson: cleanCopy(followUp.changesJson) });
  }
});
