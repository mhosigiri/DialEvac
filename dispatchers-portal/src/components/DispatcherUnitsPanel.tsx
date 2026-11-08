import React from "react";
import { Ambulance, Car, Shield, Check, Navigation, AlertCircle } from "lucide-react";
import type { Vehicle, Assignment, Request, Household } from "../module_bindings/types";

interface DispatcherUnitsPanelProps {
  vehicles: readonly Vehicle[];
  assignments: readonly Assignment[];
  requests: readonly Request[];
  households: readonly Household[];
  onSelectVehicle?: (vehicle: Vehicle) => void;
  selectedVehicleId?: bigint;
}

export const DispatcherUnitsPanel: React.FC<DispatcherUnitsPanelProps> = ({
  vehicles,
  assignments,
  requests,
  households,
  onSelectVehicle,
  selectedVehicleId,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col h-full shadow-lg">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-sky-400" />
          <h2 className="font-bold text-sm text-slate-100">Rescue Fleet & Units</h2>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
          {vehicles.length} Units Online
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
        {vehicles.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No active rescue units loaded in SpacetimeDB.
          </div>
        ) : (
          vehicles.map((v) => {
            // Find active assignment for this vehicle
            const activeAssignment = assignments.find(
              (a) => a.vehicleId === v.id && (a.status === "accepted" || a.status === "offered")
            );
            const assignedRequest = activeAssignment
              ? requests.find((r) => r.id === activeAssignment.requestId)
              : undefined;
            const assignedHousehold = assignedRequest
              ? households.find((h) => h.id === assignedRequest.householdId)
              : undefined;

            const isSelected = selectedVehicleId === v.id;

            return (
              <div
                key={String(v.id)}
                onClick={() => onSelectVehicle?.(v)}
                className={`p-3 rounded-xl border transition cursor-pointer ${
                  isSelected
                    ? "bg-sky-950/40 border-sky-500/80 shadow-md shadow-sky-950/40"
                    : "bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950/80"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`p-2 rounded-lg ${
                        v.kind === "ambulance"
                          ? "bg-red-500/10 text-red-400 border border-red-500/20"
                          : "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                      }`}
                    >
                      {v.kind === "ambulance" ? (
                        <Ambulance className="w-4 h-4" />
                      ) : (
                        <Car className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-xs text-slate-100 flex items-center gap-1.5">
                        <span>{v.name}</span>
                        {v.lift && (
                          <span className="text-[10px] px-1 rounded bg-amber-500/20 text-amber-300 font-mono">
                            LIFT
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">Driver: {v.driverName}</div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      activeAssignment?.status === "accepted"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : activeAssignment?.status === "offered"
                        ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 animate-pulse"
                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    }`}
                  >
                    {activeAssignment?.status === "accepted"
                      ? "En Route"
                      : activeAssignment?.status === "offered"
                      ? "Offered"
                      : "Available"}
                  </span>
                </div>

                {/* Capabilities pills */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    Seats: {v.seats}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    ♿ {v.wheelchairSpaces}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    🛏️ {v.stretcherSpaces}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                    Crew: {v.crew}
                  </span>
                </div>

                {/* Active Mission Destination if Assigned */}
                {assignedHousehold && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-300 truncate">
                      <Navigation className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="truncate">{assignedHousehold.address}</span>
                    </div>
                    {activeAssignment?.etaMinutes && (
                      <span className="text-amber-400 font-semibold shrink-0">
                        {activeAssignment.etaMinutes}m ETA
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
