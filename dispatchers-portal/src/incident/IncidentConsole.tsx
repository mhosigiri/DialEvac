import React, { useMemo, useState } from "react";
import { useReducer, useSpacetimeDB, useTable } from "spacetimedb/react";
import { reducers, tables } from "../module_bindings";
import { Button } from "../design-system/Button";
import { IncidentMap, type EditMode } from "./IncidentMap";
import { previewRidersCsv, RIDER_CSV_EXAMPLE, type CsvPreview } from "./csv";
import { fictionalContact, ringsForPoints, type IncidentPoint } from "../../../shared/incident";
import { insidePolygon } from "../../../spacetimedb/src/domain/geo";

const input: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #3a3a45", color: "#f5f5f6", background: "#131316", fontSize: 13 };
const card: React.CSSProperties = { border: "1px solid #30303a", background: "#111114", borderRadius: 14, padding: 18 };
export function IncidentConsole({ onError }: { onError: (error: unknown) => void }) {
  const { isActive } = useSpacetimeDB();
  const [homes] = useTable(tables.household), [zones] = useTable(tables.zone), [roads] = useTable(tables.roadClosure), [controls] = useTable(tables.control);
  const importRiders = useReducer(reducers.importRiders), setZone = useReducer(reducers.setZone), issueWarning = useReducer(reducers.issueWarning);
  const closeRoad = useReducer(reducers.closeRoad), reopenRoad = useReducer(reducers.reopenRoad), endNight = useReducer(reducers.endNight);
  const [mode, setMode] = useState<EditMode>("none"), [vertices, setVertices] = useState<IncidentPoint[]>([]), [roadPoint, setRoadPoint] = useState<IncidentPoint>();
  const [street, setStreet] = useState(""), [hazard, setHazard] = useState("flood"), [csv, setCsv] = useState<CsvPreview>(), [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState<string>(), [notice, setNotice] = useState("");
  const control = controls[0], activeRoads = roads.filter(r => r.active), savedZone = zones.find(z => z.externalId === "operator-zone" && z.active);
  const disabled = !isActive || !!busy;
  const boundary = useMemo(() => { try { return { rings: ringsForPoints(vertices), error: "" }; } catch (e) { return { rings: undefined, error: (e as Error).message }; } }, [vertices]);
  const inDraft = boundary.rings ? homes.filter(h => insidePolygon(h, boundary.rings!)).length : 0;
  const run = async (name: string, operation: () => Promise<void>) => {
    setBusy(name); setNotice("");
    try { await operation(); setNotice(`${name} completed.`); } catch (error) { setNotice(`${name} failed. ${(error as Error).message}`); onError(error); }
    finally { setBusy(undefined); }
  };
  const onPoint = (kind: EditMode, p: IncidentPoint) => kind === "zone" ? setVertices(v => v.length < 500 ? [...v, p] : v) : kind === "closure" ? setRoadPoint(p) : undefined;
  return <div className="space-y-4" style={{ color: "#f5f5f6" }}>
    <header><h2 style={{ margin: "0 0 6px", fontSize: 22 }}>Incident console</h2><p style={{ margin: 0, fontSize: 13, color: "#a3a3aa" }}>Draw the outreach area, manage blocked roads, and import the rider roster before starting outreach.</p></header>
    {notice && <p role="status" style={{ ...card, padding: 12 }}>{notice}</p>}
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <section className="xl:col-span-2" style={card} aria-label="Incident map controls">
        <div className="flex flex-wrap gap-2" style={{ marginBottom: 12 }}>
          <Button variant={mode === "zone" ? "primary" : "secondary"} onClick={() => { setMode("zone"); setNotice(""); }}>Draw boundary</Button>
          <Button variant={mode === "closure" ? "primary" : "secondary"} onClick={() => setMode("closure")}>Mark closure</Button>
          <Button variant="secondary" onClick={() => setMode("none")}>Pan map</Button>
          <Button variant="secondary" disabled={!vertices.length} onClick={() => setVertices(v => v.slice(0, -1))}>Undo corner</Button>
          <Button variant="secondary" disabled={!vertices.length} onClick={() => setVertices([])}>Clear draft</Button>
        </div>
        <IncidentMap mode={mode} vertices={vertices} closures={activeRoads} homes={homes.filter(h => h.inZone)} onPoint={onPoint} />
        <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 12 }}>
          <Button disabled={disabled || !boundary.rings} onClick={() => void run("Save outreach area", async () => { await setZone({ ringsJson: JSON.stringify(boundary.rings) }); setMode("none"); })}>Save outreach area</Button>
          <span style={{ fontSize: 12 }}>{boundary.rings ? `${inDraft} riders inside the draft boundary` : vertices.length ? boundary.error : "Add at least three boundary corners"}</span>
        </div>
        {savedZone && <p style={{ fontSize: 12, color: "#a3a3aa" }}>A saved operator boundary is active. {homes.filter(h => h.inZone).length} riders are currently in the outreach area.</p>}
        {control?.warningAt && <p style={{ fontSize: 12, color: "#e8b84b" }}>Outreach is running. Saving a larger area can start outreach for riders entering it.</p>}
      </section>
      <div className="space-y-4">
        <section style={card} aria-label="Warning controls"><h3 style={{ marginTop: 0 }}>Start outreach</h3>
          <label style={{ fontSize: 12 }}>Hazard<select aria-label="Warning hazard" value={hazard} onChange={e => setHazard(e.target.value)} style={{ ...input, margin: "6px 0 12px" }}><option value="flood">Flood</option><option value="hurricane">Hurricane</option><option value="tornado">Tornado</option><option value="wildfire">Wildfire</option><option value="earthquake">Earthquake</option></select></label>
          <p style={{ fontSize: 12, color: "#a3a3aa" }}>Starting a warning queues survey texts and calls for the {homes.filter(h => h.inZone).length} in-zone riders. Contact delivery follows the configured service and allowlist.</p>
          <Button disabled={disabled || !savedZone || !!control?.warningAt || !homes.some(h => h.inZone)} onClick={() => void run("Start warning", () => issueWarning({ hazard }))}>Start warning</Button>
          {control?.warningAt && <div style={{ marginTop: 10 }}><p style={{ fontSize: 12 }}>Active warning: {control.hazard}</p><Button variant="secondary" disabled={disabled} onClick={() => void run("End warning", () => endNight())}>End warning</Button></div>}
        </section>
        <section style={card} aria-label="Road closure controls"><h3 style={{ marginTop: 0 }}>Road closures</h3>
          <p style={{ fontSize: 12, color: "#a3a3aa" }}>{roadPoint ? `Selected: ${roadPoint.lat.toFixed(6)}, ${roadPoint.lng.toFixed(6)}` : "Choose Mark closure and click the blocked road."}</p>
          <input aria-label="Closed street name" placeholder="Street or intersection" value={street} onChange={e => setStreet(e.target.value)} maxLength={300} style={{ ...input, marginBottom: 10 }} />
          <Button disabled={disabled || !roadPoint || !street.trim()} onClick={() => void run("Close road", async () => { await closeRoad({ externalId: `operator-road-${crypto.randomUUID()}`, source: "manual", street: street.trim(), ...roadPoint! }); setRoadPoint(undefined); setStreet(""); setMode("none"); })}>Save road closure</Button>
          <p style={{ fontSize: 12, color: "#a3a3aa" }}>Closures trigger replanning and prevent routes through the recorded location.</p>
          <ul style={{ listStyle: "none", padding: 0, fontSize: 12 }}>{activeRoads.map(r => <li key={String(r.id)} style={{ borderTop: "1px solid #30303a", padding: "9px 0" }}><div>{r.street}</div><small>{r.lat.toFixed(5)}, {r.lng.toFixed(5)}</small><div style={{ marginTop: 5 }}><Button size="sm" variant="secondary" disabled={disabled} onClick={() => void run("Reopen road", () => reopenRoad({ externalId: r.externalId }))}>Reopen {r.street}</Button></div></li>)}</ul>
          {!activeRoads.length && <p style={{ fontSize: 12 }}>No active closures.</p>}
        </section>
      </div>
    </div>
    <section style={card} aria-label="CSV rider import"><h3 style={{ marginTop: 0 }}>Import riders from CSV</h3>
      <p style={{ fontSize: 12, color: "#a3a3aa" }}>Required columns: rider_id, name, address, lat, lng, phone. Optional: language, mobility, assistance, people, oxygen, need_probability. Existing rider IDs update their records. Previewing a file changes nothing.</p>
      <div className="flex gap-3 items-center flex-wrap"><input aria-label="Rider CSV file" type="file" accept=".csv,text/csv" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setFileName(f.name); setCsv(f.size > 1_000_000 ? { riders: [], errors: ["CSV limit is 1 MB"] } : previewRidersCsv(await f.text())); }} />
        <Button variant="secondary" onClick={() => { const a = document.createElement("a"), url = URL.createObjectURL(new Blob([RIDER_CSV_EXAMPLE], { type: "text/csv" })); a.href = url; a.download = "riders-example.csv"; a.click(); URL.revokeObjectURL(url); }}>Download example</Button></div>
      {csv && <div style={{ marginTop: 14 }}><p>{fileName}: {csv.riders.length} valid riders · {csv.errors.length} errors</p>
        {csv.errors.length > 0 && <ul role="alert" style={{ color: "#f87171", fontSize: 12 }}>{csv.errors.slice(0, 20).map((error, i) => <li key={i}>{error}</li>)}</ul>}
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", fontSize: 12, textAlign: "left", marginBottom: 12 }}><thead><tr><th>ID</th><th>Name</th><th>Address</th><th>Phone</th><th>Needs</th></tr></thead><tbody>{csv.riders.slice(0, 10).map(r => <tr key={r.riderId}><td>{r.riderId}</td><td>{r.name}</td><td>{r.address}</td><td>{r.phone}</td><td>{r.mobility}{r.oxygen ? " · oxygen" : ""}</td></tr>)}</tbody></table></div>
        <p style={{ fontSize: 12, color: "#a3a3aa" }}>{csv.riders.filter(r => fictionalContact(r.phone)).length} fictional contacts. Isolated demo imports require fictional 555 contacts.</p>
        {control?.warningAt && <p style={{ fontSize: 12, color: "#e8b84b" }}>An active warning may begin outreach to newly imported riders inside the saved boundary.</p>}
        <Button disabled={disabled || !!csv.errors.length || !csv.riders.length} onClick={() => void run("Import riders", () => importRiders({ riders: csv.riders.map(r => ({ ...r, people: r.people, oxygen: r.oxygen, needProbability: r.needProbability })) }))}>Import {csv.riders.length} riders</Button>
      </div>}
    </section>
  </div>;
}
