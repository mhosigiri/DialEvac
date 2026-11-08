import L from "leaflet";
import { DbConnection } from "./module_bindings";
import type { Vehicle } from "./module_bindings/types";

const ORIGIN: L.LatLngExpression = [32.9857, -96.7502];

const params = new URLSearchParams(location.search);
const uri = params.get("uri") || import.meta.env.VITE_SPACETIME_URI || "ws://127.0.0.1:3000";
const database = params.get("db") || import.meta.env.VITE_SPACETIME_DB || "hackutd";

export function connectMap(root: HTMLElement) {
  const status = document.getElementById("status");
  const meta = document.getElementById("meta");
  const fleet = document.getElementById("fleet");
  const seed = document.getElementById("seed") as HTMLButtonElement | null;
  const rows = new Map<string, Vehicle>();
  const map = L.map(root).setView(ORIGIN, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  const markers = new Map<string, L.CircleMarker>();
  let zoneLayer: L.Polygon | undefined;
  let subscribed = false;
  let fitted = false;

  const renderFleet = () => {
    if (!fleet) return;
    fleet.replaceChildren();
    for (const row of [...rows.values()].sort((a, b) => Number(a.id - b.id))) {
      const line = document.createElement("div");
      line.dataset.vehicleId = row.id.toString();
      line.textContent = `${row.name} ${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}`;
      fleet.append(line);
    }
  };

  const upsert = (row: Vehicle) => {
    const id = row.id.toString();
    rows.set(id, row);
    const latlng: L.LatLngExpression = [row.lat, row.lng];
    const color = row.simulated ? "#e2b657" : "#6cb6ff";
    const existing = markers.get(id);
    const popup = `${row.name}<br>${row.driverName}<br>${row.kind}${row.simulated ? "<br>simulated" : ""}`;
    if (existing) {
      existing.setLatLng(latlng);
      existing.setStyle({ color, fillColor: color });
      existing.setPopupContent(popup);
      renderFleet();
      return;
    }
    const marker = L.circleMarker(latlng, { radius: 8, color, fillColor: color, fillOpacity: 0.9, weight: 2 }).addTo(map);
    marker.bindPopup(popup);
    markers.set(id, marker);
    renderFleet();
  };

  const remove = (row: Vehicle) => {
    const id = row.id.toString();
    rows.delete(id);
    markers.get(id)?.remove();
    markers.delete(id);
    renderFleet();
  };

  const drawZone = (ringsJson: string, active: boolean) => {
    zoneLayer?.remove();
    zoneLayer = undefined;
    if (!active) return;
    const rings = JSON.parse(ringsJson) as [number, number][][];
    const latlngs = (rings[0] ?? []).map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
    zoneLayer = L.polygon(latlngs, { color: "#c45c26", weight: 2, fillOpacity: 0.08 }).addTo(map);
  };

  const builder = DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(database)
    .onConnect((conn) => {
      if (status) status.textContent = `live · ${database}`;
      if (meta) meta.textContent = uri;
      if (seed) {
        seed.disabled = false;
        seed.onclick = () => conn.reducers.seedTornadoDemo({});
      }
      if (subscribed) return;
      subscribed = true;
      conn.subscriptionBuilder()
        .onApplied(() => {
          for (const row of conn.db.vehicle.iter()) upsert(row);
          for (const row of conn.db.zone.iter()) drawZone(row.rings, row.active);
          if (!fitted && rows.size > 0) {
            fitted = true;
            const bounds = L.latLngBounds([...rows.values()].map((row) => [row.lat, row.lng] as L.LatLngTuple));
            if (zoneLayer) bounds.extend(zoneLayer.getBounds());
            map.fitBounds(bounds, { padding: [48, 48] });
          }
        })
        .onError((ctx) => {
          if (status) status.textContent = `subscribe failed: ${String(ctx.event ?? "unknown")}`;
        })
        .subscribe(["SELECT * FROM vehicle", "SELECT * FROM zone"]);
      conn.db.vehicle.onInsert((_ctx, row) => upsert(row));
      conn.db.vehicle.onUpdate((_ctx, _old, row) => upsert(row));
      conn.db.vehicle.onDelete((_ctx, row) => remove(row));
      conn.db.zone.onInsert((_ctx, row) => drawZone(row.rings, row.active));
      conn.db.zone.onUpdate((_ctx, _old, row) => drawZone(row.rings, row.active));
      conn.db.zone.onDelete(() => {
        zoneLayer?.remove();
        zoneLayer = undefined;
      });
    })
    .onConnectError((_ctx, error) => {
      if (status) status.textContent = `connect failed: ${error}`;
    })
    .onDisconnect(() => {
      if (status) status.textContent = "disconnected";
    })
    .build();

  void builder;
}
