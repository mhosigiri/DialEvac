import React, { useState } from "react";
import type { DriverStop } from "../lib/driver-state";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { Card } from "../design-system/Card";
import { EmptyState } from "../design-system/EmptyState";

interface RunListProps {
  stops: DriverStop[];
  onSelectStop: (stop: DriverStop) => void;
  selectedStopId?: bigint;
  onCancelStop: (assignmentId: bigint, reason: string) => void;
  busy: boolean;
}

export const RunList: React.FC<RunListProps> = ({
  stops,
  onSelectStop,
  selectedStopId,
  onCancelStop,
  busy,
}) => {
  const [cancellingStopId, setCancellingStopId] = useState<bigint | undefined>();
  const [cancelReason, setCancelReason] = useState("");

  if (stops.length === 0) {
    return (
      <div className="py-12 px-4 max-w-md mx-auto">
        <EmptyState
          title="No Active Stops"
          detail="Your manifest is currently empty. As dispatchers assign evacuation cases or solver matches, live offers will appear here for you to accept."
        />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#f5f5f6]">Assigned Run List</h2>
          <p className="text-xs text-[#a3a3aa]">
            {stops.length} {stops.length === 1 ? "pickup stop" : "stops"} queued on your vehicle manifest
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#3dd68c]/15 text-[#3dd68c] border border-[#3dd68c]/30">
          ● Active Mission
        </span>
      </div>

      <div className="space-y-3.5">
        {stops.map((stop, index) => {
          const isSelected = stop.assignmentId === selectedStopId;
          const isWheelchair = stop.mobility === "wheelchair";

          return (
            <div
              key={stop.assignmentId.toString()}
              className={`rounded-2xl border transition-all overflow-hidden ${
                isSelected
                  ? "bg-[#16161b] border-[#8fb0ff] shadow-[0_4px_24px_rgba(143,176,255,0.15)] ring-1 ring-[#8fb0ff]/40"
                  : "bg-[#131316] border-[#26262c] hover:border-[#33333a]"
              }`}
            >
              {/* Stop Number Bar */}
              <div className="px-4 py-2.5 bg-[#1a1a1f] border-b border-[#26262c] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[#8fb0ff] text-black font-extrabold text-xs flex items-center justify-center">
                    {index + 1}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#f5f5f6]">
                    Pickup Stop
                  </span>
                </div>
                {!!stop.etaMinutes && (
                  <span className="text-xs font-semibold text-[#3dd68c]">
                    ~{stop.etaMinutes} min ETA
                  </span>
                )}
              </div>

              {/* Resident & Stop Details */}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-[#f5f5f6] leading-tight">
                      {stop.residentName}
                    </h3>
                    <p className="text-[13px] text-[#c2c2c9] mt-0.5 leading-snug">
                      {stop.address}
                    </p>
                  </div>
                  {stop.phone && (
                    <a
                      href={`tel:${stop.phone}`}
                      className="flex-none p-2 rounded-xl bg-[#3dd68c]/15 border border-[#3dd68c]/30 text-[#3dd68c] hover:bg-[#3dd68c]/25 transition-colors flex items-center gap-1.5 text-xs font-bold"
                      title="Call resident"
                    >
                      <span className="text-sm">📞</span>
                      <span className="hidden sm:inline">Call</span>
                    </a>
                  )}
                </div>

                {/* Badges / Needs */}
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge tone="neutral">{stop.people} {stop.people === 1 ? "Rider" : "Riders"}</Badge>
                  {isWheelchair && (
                    <Badge tone="warning">♿ Wheelchair Lift</Badge>
                  )}
                  {stop.assistance !== "none" && (
                    <Badge tone="danger">Assist: {stop.assistance.replace("_", " ")}</Badge>
                  )}
                  {stop.shelter && (
                    <Badge tone="neutral">Destination: {stop.shelter.name}</Badge>
                  )}
                </div>

                {/* Action Buttons for this Stop */}
                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectStop(stop)}
                    className="flex-1 min-h-[44px] rounded-xl bg-[#8fb0ff] hover:bg-[#a8c4ff] text-black font-bold text-sm flex items-center justify-center gap-2 transition-transform active:scale-[0.98] shadow-md"
                  >
                    <span>🧭 Start Navigation</span>
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setCancellingStopId(stop.assignmentId);
                      setCancelReason("");
                    }}
                    className="px-3 min-h-[44px] rounded-xl bg-[#1a1a1f] hover:bg-[#26262c] text-[#f87171] border border-[#2e2e36] text-xs font-semibold"
                    title="Unable to complete stop"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cancel Stop Confirmation Modal */}
      {cancellingStopId !== undefined && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#131316] border border-[#26262c] rounded-2xl p-5 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-[#f5f5f6]">Report Issue / Cancel Stop</h3>
            <p className="text-xs text-[#a3a3aa]">
              This releases the assignment back to dispatchers and notifies the operations team.
            </p>

            <div>
              <label className="block text-xs font-semibold text-[#c2c2c9] mb-1.5">
                Reason for cancellation:
              </label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-[#1a1a1f] border border-[#2e2e36] text-sm text-[#f5f5f6] focus:border-[#8fb0ff]"
              >
                <option value="">Select a reason...</option>
                <option value="Road impassable / high water">Road impassable / high water</option>
                <option value="Resident already evacuated">Resident already evacuated</option>
                <option value="No response at address">No response at address</option>
                <option value="Vehicle mechanical issue">Vehicle mechanical issue</option>
                <option value="Driver cannot make pickup">Driver cannot make pickup</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setCancellingStopId(undefined)}
              >
                Keep Stop
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={!cancelReason || busy}
                onClick={() => {
                  onCancelStop(cancellingStopId, cancelReason);
                  setCancellingStopId(undefined);
                }}
              >
                Confirm Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
