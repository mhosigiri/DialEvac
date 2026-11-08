import React, { useState } from "react";
import { MessageSquare, Send, Radio, Truck, CheckCircle2, AlertTriangle, CornerDownRight } from "lucide-react";
import type { Vehicle, Assignment, Request, Household, Message } from "../module_bindings/types";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";
import { Section } from "./CaseFileParts";
import type { Command } from "../commands";

interface DriverCommsProps {
  household: Household;
  request?: Request;
  assignment?: Assignment;
  vehicle?: Vehicle;
  vehicles: readonly Vehicle[];
  messages: readonly Message[];
  disabled: boolean;
  send: (command: Command) => void;
  onSendDriverNote?: (body: string) => void;
}

export const DriverComms: React.FC<DriverCommsProps> = ({
  household,
  request,
  assignment,
  vehicle,
  vehicles,
  messages,
  disabled,
  send,
  onSendDriverNote,
}) => {
  const [note, setNote] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<bigint | undefined>(
    vehicle ? vehicle.id : (vehicles[0]?.id)
  );

  // Filter messages for this household tagged for driver/field comms
  const commsNotes = messages
    .filter((m) => m.householdId === household.id)
    .sort((a, b) => Number(a.at.toMillis() - b.at.toMillis()));

  const isOffered = assignment?.status === "offered";
  const isAccepted = assignment?.status === "accepted";

  const handleSendNote = () => {
    if (!note.trim()) return;
    if (onSendDriverNote) {
      onSendDriverNote(note.trim());
    }
    setNote("");
  };

  return (
    <Section title="Driver & Dispatch Coordination">
      {/* Unit Status Card */}
      <div className="bg-[#1a1a1f] border border-[#2e2e36] rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#8fb0ff]/15 flex items-center justify-center text-[#8fb0ff]">
              <Truck size={16} />
            </div>
            <div>
              <div className="text-xs font-bold text-[#f5f5f6]">
                {vehicle ? vehicle.name : "No Unit Assigned"}
              </div>
              <div className="text-[11px] text-[#a3a3aa]">
                {vehicle ? `${vehicle.kind} · Driver: ${vehicle.driverName}` : "Select a unit to dispatch"}
              </div>
            </div>
          </div>

          <div>
            {isAccepted && <Badge tone="success">Driver Accepted · En Route</Badge>}
            {isOffered && <Badge tone="warning" dot>Offer Pending Driver Acceptance</Badge>}
            {!assignment && <Badge tone="neutral">Unassigned</Badge>}
          </div>
        </div>

        {/* Dispatch & Drive Acceptance Controls */}
        <div className="pt-1 border-t border-[#26262c] flex flex-wrap items-center gap-2">
          {!assignment && request && (
            <div className="w-full flex items-center gap-2">
              <select
                value={selectedVehicleId?.toString() || ""}
                onChange={(e) => setSelectedVehicleId(BigInt(e.target.value))}
                className="flex-1 p-2 rounded-lg bg-[#131316] border border-[#26262c] text-xs text-[#f5f5f6]"
              >
                {vehicles.map((v) => (
                  <option key={v.id.toString()} value={v.id.toString()}>
                    {v.name} ({v.kind}) - {v.seats} seats
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                size="sm"
                disabled={disabled || !selectedVehicleId}
                onClick={() =>
                  send({
                    kind: "dispatch",
                    requestId: request.id,
                    vehicleId: selectedVehicleId!,
                    etaMinutes: 6,
                    stopOrder: 1,
                  })
                }
              >
                Dispatch Unit
              </Button>
            </div>
          )}

          {isOffered && (
            <div className="w-full flex items-center justify-between gap-2 bg-[#e8b84b]/10 border border-[#e8b84b]/30 p-2.5 rounded-lg">
              <div className="text-xs text-[#e8b84b] flex items-center gap-1.5">
                <Radio size={14} className="animate-pulse" />
                <span>Offer sent to mobile driver app. Waiting for driver tap...</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={disabled}
                  onClick={() => send({ kind: "accept", assignmentId: assignment.id })}
                >
                  Accept for Driver (Radio)
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => send({ kind: "decline", assignmentId: assignment.id })}
                >
                  Decline
                </Button>
              </div>
            </div>
          )}

          {isAccepted && (
            <div className="w-full flex items-center justify-between text-xs text-[#3dd68c] bg-[#3dd68c]/10 border border-[#3dd68c]/30 p-2 rounded-lg">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                <span>Driver confirmed assignment. Turn-by-turn navigation active.</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => send({ kind: "route", assignmentId: assignment.id })}
              >
                Refresh Route
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Driver Instructions / Tactical Notes Feed */}
      <div className="space-y-2 mt-3">
        <div className="flex items-center justify-between text-xs font-semibold text-[#c2c2c9]">
          <span className="flex items-center gap-1.5">
            <Radio size={13} className="text-[#8fb0ff]" />
            <span>Driver Tactical Radio & Notes</span>
          </span>
          <span className="text-[11px] text-[#a3a3aa]">Direct in-vehicle channel</span>
        </div>

        {/* Message Thread */}
        <div className="max-h-40 overflow-y-auto no-scrollbar bg-[#0e0e11] border border-[#26262c] rounded-xl p-2.5 space-y-2 text-xs">
          {commsNotes.length === 0 ? (
            <div className="text-[#a3a3aa] text-center py-3 italic">
              No tactical notes logged yet. Send directions, hazard alerts, or resident entry instructions directly to the driver's screen.
            </div>
          ) : (
            commsNotes.map((m) => (
              <div
                key={m.id.toString()}
                className={`p-2 rounded-lg flex items-start gap-2 ${
                  m.direction === "out"
                    ? "bg-[#1a1a1f] border border-[#2e2e36] text-[#f5f5f6]"
                    : "bg-[#8fb0ff]/10 border border-[#8fb0ff]/20 text-[#8fb0ff]"
                }`}
              >
                <span className="font-bold text-[10px] uppercase tracking-wider text-[#a3a3aa] mt-0.5">
                  {m.direction === "out" ? "EOC:" : "Driver:"}
                </span>
                <span className="flex-1 leading-snug">{m.body}</span>
              </div>
            ))
          )}
        </div>

        {/* Quick Send Input */}
        <div className="flex items-center gap-1.5 pt-1">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendNote()}
            placeholder="Type tactical instruction to driver (e.g., Avoid Allen Pkwy)..."
            className="flex-1 px-3 py-2 rounded-xl bg-[#1a1a1f] border border-[#2e2e36] text-xs text-[#f5f5f6] focus:border-[#8fb0ff] focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSendNote}
            disabled={!note.trim()}
            className="p-2 rounded-xl bg-[#8fb0ff] hover:bg-[#a8c4ff] text-black font-bold text-xs disabled:opacity-40 transition-colors flex items-center justify-center"
            title="Send note to driver"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </Section>
  );
};
