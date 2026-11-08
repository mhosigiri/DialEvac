import React, { useState } from "react";
import { createPortal } from "react-dom";
import type { Vehicle } from "../module_bindings/types";
import { Badge } from "../design-system/Badge";
import logoImg from "../assets/logo.png";

interface DriverHeaderProps {
  vehicles: readonly Vehicle[];
  selectedVehicleId?: bigint;
  onSelectVehicle: (id: bigint) => void;
  connected: boolean;
  offersCount: number;
  onOpenComms?: () => void;
}

export const DriverHeader: React.FC<DriverHeaderProps> = ({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
  connected,
  offersCount,
  onOpenComms,
}) => {
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const currentVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  return (
    <header className="sticky top-0 z-30 bg-[#060607]/95 backdrop-blur-md border-b border-[#26262c] px-4 py-3">
      <div className="flex items-center justify-between gap-3 max-w-lg mx-auto">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 flex-none rounded-lg bg-white overflow-hidden flex items-center justify-center shadow-md p-0.5">
            <img src={logoImg} alt="DialEvac" className="w-full h-full object-contain rounded-md" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[15px] tracking-tight text-[#f5f5f6] whitespace-nowrap">
                DialEvac<span className="hidden sm:inline"> Driver</span>
              </span>
              <span
                className={`w-2 h-2 flex-none rounded-full ${
                  connected ? "bg-[#3dd68c] shadow-[0_0_8px_#3dd68c]" : "bg-[#f87171]"
                }`}
                title={connected ? "Connected to SpacetimeDB" : "Reconnecting..."}
              />
            </div>
            <div className="hidden sm:block text-[11px] text-[#a3a3aa] font-medium leading-none mt-0.5">
              Emergency Response Mobile Unit
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-none">
          {onOpenComms && (
            <button
              type="button"
              onClick={onOpenComms}
              className="px-2.5 py-1.5 rounded-xl bg-[#1a1a1f] hover:bg-[#26262c] border border-[#2e2e36] text-[12px] font-bold text-[#8fb0ff] flex items-center gap-1.5 transition-colors"
              title="Open dispatch comms"
              aria-label="Open dispatch comms"
            >
              <span>📻</span>
              <span className="hidden sm:inline">Comms</span>
            </button>
          )}

          {/* Vehicle Selector Badge / Button */}
          <button
            type="button"
            onClick={() => setShowVehiclePicker(!showVehiclePicker)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1a1a1f] hover:bg-[#26262c] border border-[#2e2e36] text-[12.5px] font-semibold text-[#f5f5f6] transition-colors active:scale-95"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#8fb0ff]" />
            <span className="truncate max-w-[100px] sm:max-w-[160px]">
              {currentVehicle ? currentVehicle.name : "Select Unit"}
            </span>
            <svg
              className={`w-3.5 h-3.5 text-[#a3a3aa] transition-transform ${showVehiclePicker ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* The header's backdrop-blur traps fixed children inside the header, so the modal renders on body. */}
      {showVehiclePicker && createPortal(
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#131316] border border-[#26262c] rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl animate-in fade-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-[#f5f5f6]">Select Vehicle Unit</h3>
                <p className="text-xs text-[#a3a3aa] mt-0.5">
                  Pick your assigned responder unit to view your dispatch run list
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowVehiclePicker(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#1a1a1f] text-[#c2c2c9] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto no-scrollbar py-1">
              {vehicles.map((v) => {
                const isSelected = v.id === selectedVehicleId;
                return (
                  <button
                    key={v.id.toString()}
                    type="button"
                    onClick={() => {
                      onSelectVehicle(v.id);
                      setShowVehiclePicker(false);
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? "bg-[#8fb0ff]/10 border-[#8fb0ff] text-white"
                        : "bg-[#1a1a1f] border-[#26262c] hover:border-[#33333a] text-[#c2c2c9]"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-[13.5px] text-[#f5f5f6] flex items-center gap-2">
                        {v.name}
                        {v.lift && (
                          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 bg-[#8fb0ff]/20 text-[#8fb0ff] rounded">
                            Wheelchair Lift
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#a3a3aa] mt-0.5">
                        {v.kind} · Driver: {v.driverName}
                      </div>
                      <div className="text-[11px] text-[#8a8a92] mt-1 flex gap-3">
                        <span>Seats: {v.seats}</span>
                        <span>Wheelchair: {v.wheelchairSpaces}</span>
                        <span>Crew: {v.crew}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-[#8fb0ff] text-black flex items-center justify-center text-xs font-bold">
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}

              {vehicles.length === 0 && (
                <div className="text-center py-6 text-sm text-[#a3a3aa]">
                  No vehicles available in database.
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
};
