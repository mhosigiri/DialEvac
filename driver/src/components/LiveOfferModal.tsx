import React, { useEffect, useState } from "react";
import type { Assignment, Household, Request } from "../module_bindings/types";
import { OFFER_SECONDS } from "../../../shared/offer-timing";
import { Badge } from "../design-system/Badge";

interface LiveOfferModalProps {
  assignment: Assignment;
  request?: Request;
  household?: Household;
  onAccept: (assignmentId: bigint) => void;
  onDecline: (assignmentId: bigint) => void;
  busy: boolean;
}

const secondsUntilExpiry = (offeredAt: Assignment["offeredAt"], now: number) => {
  if (!offeredAt) return undefined;
  const elapsed = (now - Number(offeredAt.toMillis())) / 1000;
  return Math.min(OFFER_SECONDS, Math.max(0, Math.ceil(OFFER_SECONDS - elapsed)));
};

export const LiveOfferModal: React.FC<LiveOfferModalProps> = ({
  assignment,
  request,
  household,
  onAccept,
  onDecline,
  busy,
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const secondsLeft = secondsUntilExpiry(assignment.offeredAt, now);
  const isWheelchair = request?.mobility === "wheelchair" || household?.mobility === "wheelchair";
  const people = request?.people || 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col justify-end sm:justify-center p-3 sm:p-5 animate-in fade-in duration-200">
      <div className="w-full max-w-lg mx-auto bg-[#131316] border-2 border-[#e8b84b] rounded-2xl shadow-[0_0_50px_rgba(232,184,75,0.3)] overflow-hidden">
        {/* Countdown Progress Bar */}
        {secondsLeft !== undefined && (
          <div className="h-2 w-full bg-[#1a1a1f] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#e8b84b] to-[#f87171] transition-all duration-1000 ease-linear"
              style={{ width: `${(secondsLeft / OFFER_SECONDS) * 100}%` }}
            />
          </div>
        )}

        <div className="p-5 sm:p-6 space-y-4">
          {/* Header Tag */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e8b84b] opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#e8b84b]" />
              </span>
              <span className="text-[12px] uppercase font-bold tracking-wider text-[#e8b84b]">
                New Dispatch Offer
              </span>
            </div>
            {secondsLeft !== undefined && (
              <span className="font-mono text-sm font-bold text-[#f5f5f6] tabular-nums">
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </span>
            )}
          </div>

          {/* Resident & Destination Info */}
          <div>
            <div className="text-xl sm:text-2xl font-extrabold text-[#f5f5f6] tracking-tight">
              {household ? household.name : "Evacuation Request"}
            </div>
            <div className="text-sm font-medium text-[#c2c2c9] mt-1 flex items-start gap-1.5">
              <span className="text-[#8fb0ff] mt-0.5">📍</span>
              <span>{household ? household.address : "Location coordinates on map"}</span>
            </div>
          </div>

          {/* Key Evacuation Metrics */}
          <div className="grid grid-cols-3 gap-2.5 py-1">
            <div className="bg-[#1a1a1f] border border-[#26262c] rounded-xl p-3 text-center">
              <div className="text-[11px] text-[#a3a3aa] font-medium">Headcount</div>
              <div className="text-lg font-bold text-[#f5f5f6] mt-0.5">
                {people} {people === 1 ? "Person" : "People"}
              </div>
            </div>
            <div className="bg-[#1a1a1f] border border-[#26262c] rounded-xl p-3 text-center">
              <div className="text-[11px] text-[#a3a3aa] font-medium">Mobility</div>
              <div className="text-lg font-bold text-[#f5f5f6] mt-0.5 capitalize">
                {request?.mobility || household?.mobility || "Walks"}
              </div>
            </div>
            <div className="bg-[#1a1a1f] border border-[#26262c] rounded-xl p-3 text-center">
              <div className="text-[11px] text-[#a3a3aa] font-medium">Estimated ETA</div>
              <div className="text-lg font-bold text-[#3dd68c] mt-0.5">
                {assignment.etaMinutes ? `${assignment.etaMinutes} min` : "--"}
              </div>
            </div>
          </div>

          {/* Requirement Badges */}
          <div className="flex flex-wrap gap-1.5">
            {isWheelchair && (
              <Badge tone="warning">♿ Wheelchair Accessible Vehicle Required</Badge>
            )}
            {household?.assistance && household.assistance !== "none" && (
              <Badge tone="danger">Assistance: {household.assistance.replace("_", " ")}</Badge>
            )}
            {household?.language && household.language !== "en" && (
              <Badge tone="neutral">Language: {household.language.toUpperCase()}</Badge>
            )}
            <Badge tone="neutral">Stop #{assignment.stopOrder || 1}</Badge>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onAccept(assignment.id)}
              className="w-full min-h-[52px] rounded-xl bg-[#3dd68c] hover:bg-[#34b879] active:scale-[0.98] text-[#060607] font-bold text-base tracking-wide shadow-[0_4px_20px_rgba(61,214,140,0.35)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>ACCEPT RUN</span>
              <span className="text-lg">✓</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecline(assignment.id)}
              className="w-full min-h-[52px] rounded-xl bg-[#1a1a1f] hover:bg-[#26262c] active:scale-[0.98] text-[#f87171] border border-[#f87171]/40 font-semibold text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>Decline Offer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
