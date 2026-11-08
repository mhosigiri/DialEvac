import React, { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polygon,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { Household, Vehicle, Zone, Request, Assignment } from "../module_bindings/types";
import { parsePolygonRings, findClosestDispatchers } from "../lib/geo";

interface EmergencyMapProps {
  zone?: Zone;
  households: readonly Household[];
  vehicles: readonly Vehicle[];
  requests: readonly Request[];
  assignments: readonly Assignment[];
  selectedHousehold?: Household;
  selectedVehicleId?: bigint;
  onSelectHousehold?: (h: Household) => void;
}

// Custom DivIcons for dark mode map markers
function createVictimIcon(urgency: "critical" | "high" | "medium" | "cleared") {
  const bgClass =
    urgency === "critical"
      ? "bg-red-500 shadow-red-500/80 animate-pulse ring-4 ring-red-500/30"
      : urgency === "high"
      ? "bg-amber-500 shadow-amber-500/80 ring-2 ring-amber-500/30"
      : urgency === "medium"
      ? "bg-sky-500 shadow-sky-500/80 ring-2 ring-sky-500/30"
      : "bg-emerald-500 shadow-emerald-500/80 ring-2 ring-emerald-500/30";

  return L.divIcon({
    className: "custom-victim-marker",
    html: `<div class="w-4 h-4 rounded-full ${bgClass} border-2 border-white shadow-lg flex items-center justify-center"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

function createVehicleIcon(kind: string, isEnRoute: boolean) {
  const isAmbulance = kind === "ambulance";
  const bgClass = isAmbulance ? "bg-red-600" : "bg-sky-600";
  const borderClass = isEnRoute ? "border-amber-400 ring-2 ring-amber-400/50" : "border-slate-200";

  return L.divIcon({
    className: "custom-vehicle-marker",
    html: `
      <div class="px-2 py-1 rounded-lg ${bgClass} ${borderClass} border text-[11px] font-bold text-white shadow-xl flex items-center gap-1 -translate-x-1/2 -translate-y-1/2">
        <span>${isAmbulance ? "🚑" : "🚐"}</span>
      </div>
    `,
    iconSize: [32, 24],
    iconAnchor: [16, 12],
    popupAnchor: [0, -14],
  });
}

// Center map controller component
function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  React.useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
}

export const EmergencyMap: React.FC<EmergencyMapProps> = ({
  zone,
  households,
  vehicles,
  requests,
  assignments,
  selectedHousehold,
  selectedVehicleId,
  onSelectHousehold,
}) => {
  // Parse zone rings
  const polygonCoords = useMemo(() => {
    if (!zone?.rings) return [];
    return parsePolygonRings(zone.rings);
  }, [zone?.rings]);

  // Determine initial center
  const center: [number, number] = useMemo(() => {
    if (selectedHousehold) return [selectedHousehold.lat, selectedHousehold.lng];
    if (polygonCoords.length > 0) return polygonCoords[0];
    if (households.length > 0) return [households[0].lat, households[0].lng];
    return [32.9857, -96.7502]; // Richardson / UTD default
  }, [selectedHousehold, polygonCoords, households]);

  // Build active dispatch graph connection lines (Edges)
  const graphEdges = useMemo(() => {
    const lines: {
      from: [number, number];
      to: [number, number];
      color: string;
      dashArray?: string;
      label: string;
    }[] = [];

    // 1. Active assignment lines (Solid)
    for (const a of assignments) {
      if (a.status !== "accepted" && a.status !== "offered") continue;
      const vehicle = vehicles.find((v) => v.id === a.vehicleId);
      const req = requests.find((r) => r.id === a.requestId);
      if (!vehicle || !req) continue;
      const home = households.find((h) => h.id === req.householdId);
      if (!home) continue;

      lines.push({
        from: [vehicle.lat, vehicle.lng],
        to: [home.lat, home.lng],
        color: a.status === "accepted" ? "#f59e0b" : "#38bdf8",
        dashArray: a.status === "offered" ? "5, 8" : undefined,
        label: `${vehicle.name} → ${home.name} (${a.status})`,
      });
    }

    // 2. Closest match lines for open unassigned requests (Dotted Cyan)
    for (const req of requests) {
      if (req.status !== "received" && req.status !== "reassigning") continue;
      const home = households.find((h) => h.id === req.householdId);
      if (!home) continue;
      const matches = findClosestDispatchers(home, req, vehicles);
      const best = matches[0];
      if (best) {
        lines.push({
          from: [best.vehicle.lat, best.vehicle.lng],
          to: [home.lat, home.lng],
          color: "#06b6d4",
          dashArray: "4, 6",
          label: `Closest match: ${best.vehicle.name} (${best.distanceMiles} mi)`,
        });
      }
    }

    return lines;
  }, [assignments, vehicles, requests, households]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-slate-800 shadow-xl bg-slate-950">
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <MapRecenter center={center} />

        {/* Dark style tile layer from CartoDB */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maxZoom={19}
        />

        {/* Hazard Zone Polygon */}
        {polygonCoords.length > 0 && (
          <Polygon
            positions={polygonCoords}
            pathOptions={{
              color: "#ef4444",
              fillColor: "#ef4444",
              fillOpacity: 0.15,
              weight: 2,
              dashArray: "6, 8",
            }}
          />
        )}

        {/* Dispatch Graph Lines */}
        {graphEdges.map((edge, idx) => (
          <Polyline
            key={idx}
            positions={[edge.from, edge.to]}
            pathOptions={{
              color: edge.color,
              weight: 2.5,
              dashArray: edge.dashArray,
              opacity: 0.8,
            }}
          />
        ))}

        {/* Victim / Household Markers */}
        {households.map((h) => {
          const req = requests.find((r) => r.householdId === h.id);
          const isCritical = (req?.oxygen ?? h.oxygen) || (req?.mobility ?? h.mobility) === "bedbound";
          const isHigh = (req?.mobility ?? h.mobility) === "wheelchair";
          const isCleared = h.canLeave === true || req?.status === "closed";
          const urgency = isCritical ? "critical" : isHigh ? "high" : isCleared ? "cleared" : "medium";

          return (
            <Marker
              key={String(h.id)}
              position={[h.lat, h.lng]}
              icon={createVictimIcon(urgency)}
              eventHandlers={{
                click: () => onSelectHousehold?.(h),
              }}
            >
              <Popup className="dark-popup">
                <div className="p-2 text-slate-900 min-w-[200px]">
                  <div className="font-bold text-sm text-slate-900">{h.name}</div>
                  <div className="text-xs text-slate-600 mb-1">{h.address}</div>
                  <div className="text-xs font-mono text-slate-700">{h.phone}</div>
                  <div className="mt-2 text-xs flex flex-wrap gap-1">
                    {(req?.oxygen ?? h.oxygen) && (
                      <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold">
                        Oxygen
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      Mobility: {req?.mobility ?? h.mobility}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      Occupants: {req?.people ?? h.people}
                    </span>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Vehicle / Responder Unit Markers */}
        {vehicles.map((v) => {
          const activeAssignment = assignments.find(
            (a) => a.vehicleId === v.id && (a.status === "accepted" || a.status === "offered")
          );

          return (
            <Marker
              key={String(v.id)}
              position={[v.lat, v.lng]}
              icon={createVehicleIcon(v.kind, Boolean(activeAssignment))}
            >
              <Popup>
                <div className="p-2 text-slate-900 min-w-[190px]">
                  <div className="font-bold text-sm text-slate-900">{v.name}</div>
                  <div className="text-xs text-slate-600">Driver: {v.driverName}</div>
                  <div className="text-xs text-slate-600 capitalize">Type: {v.kind}</div>
                  <div className="mt-1 text-xs text-slate-700 font-medium">
                    Seats: {v.seats} • ♿ {v.wheelchairSpaces} • 🛏️ {v.stretcherSpaces}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Map Legend Overlay */}
      <div className="absolute bottom-4 left-4 z-[1000] p-3 rounded-xl bg-slate-900/90 backdrop-blur border border-slate-800 text-[11px] shadow-xl space-y-1.5">
        <div className="font-bold text-slate-200 uppercase tracking-wider text-[10px] mb-1">
          Incident Map Legend
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span>Critical (Oxygen / Bedbound)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span>High Priority (Wheelchair)</span>
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
          <span>Standard Ride Request</span>
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <span className="w-4 h-0.5 bg-cyan-400 border-t border-dashed" />
          <span>Closest Dispatcher Vector</span>
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <span className="w-4 h-0.5 bg-amber-400" />
          <span>Active Mission Route</span>
        </div>
      </div>
    </div>
  );
};
