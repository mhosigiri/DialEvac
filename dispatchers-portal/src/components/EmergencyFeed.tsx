import React, { useState } from "react";
import {
  AlertOctagon,
  HeartPulse,
  Accessibility,
  Users,
  Navigation,
  FileText,
  Phone,
  Send,
  CheckCircle,
  Clock,
  Sparkles,
  MapPin,
  Check,
} from "lucide-react";
import type { Household, Request, Vehicle, Assignment, Call } from "../module_bindings/types";
import { generateEmergencySummary } from "../lib/summary";
import { findClosestDispatchers } from "../lib/geo";

interface EmergencyFeedProps {
  households: readonly Household[];
  requests: readonly Request[];
  vehicles: readonly Vehicle[];
  assignments: readonly Assignment[];
  calls: readonly Call[];
  onOpenTranscript: (household: Household, call?: Call, request?: Request) => void;
  onDispatchClosest: (requestId: bigint, vehicleId: bigint) => void;
  onAcceptOffer: (assignmentId: bigint) => void;
  onDeclineOffer: (assignmentId: bigint) => void;
  onCloseRequest: (requestId: bigint) => void;
  onSelectVictim?: (household: Household) => void;
}

export const EmergencyFeed: React.FC<EmergencyFeedProps> = ({
  households,
  requests,
  vehicles,
  assignments,
  calls,
  onOpenTranscript,
  onDispatchClosest,
  onAcceptOffer,
  onDeclineOffer,
  onCloseRequest,
  onSelectVictim,
}) => {
  const [activeTab, setActiveTab] = useState<"all" | "critical" | "in_transit" | "cleared">("all");

  // Pair households with their active requests
  const victimItems = households.map((household) => {
    const request = requests.find((r) => r.householdId === household.id);
    const assignment = request
      ? assignments.find((a) => a.requestId === request.id && a.status !== "declined" && a.status !== "expired")
      : undefined;
    const call = calls.find((c) => c.householdId === household.id);
    const { summary, urgency } = generateEmergencySummary(household, request);
    const closestMatches = findClosestDispatchers(household, request, vehicles);
    const topMatch = closestMatches[0];

    return {
      household,
      request,
      assignment,
      call,
      summary,
      urgency,
      topMatch,
    };
  });

  // Filter based on selected tab
  const filteredItems = victimItems.filter((item) => {
    if (activeTab === "critical") {
      return item.urgency === "critical" || item.household.oxygen || item.request?.oxygen || item.household.mobility === "bedbound";
    }
    if (activeTab === "in_transit") {
      return item.request?.status === "driver_accepted" || item.request?.status === "en_route" || item.assignment?.status === "accepted";
    }
    if (activeTab === "cleared") {
      return item.household.canLeave === true || item.request?.status === "closed" || item.assignment?.status === "completed";
    }
    return true; // all
  });

  // Sort: Critical first, then in-zone, then open requests
  filteredItems.sort((a, b) => {
    const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-full shadow-xl overflow-hidden">
      {/* Feed Filter Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-red-400" />
            <h2 className="font-bold text-sm text-slate-100">Live Incident & Evacuation Triage</h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {filteredItems.length} active cases
          </span>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-900 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab("all")}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition ${
              activeTab === "all"
                ? "bg-slate-800 text-slate-100 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All Incidents
          </button>
          <button
            onClick={() => setActiveTab("critical")}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium flex items-center justify-center gap-1 transition ${
              activeTab === "critical"
                ? "bg-red-500/20 text-red-300 border border-red-500/30"
                : "text-slate-400 hover:text-red-300"
            }`}
          >
            <HeartPulse className="w-3.5 h-3.5 text-red-400" />
            <span>Critical</span>
          </button>
          <button
            onClick={() => setActiveTab("in_transit")}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition ${
              activeTab === "in_transit"
                ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                : "text-slate-400 hover:text-sky-300"
            }`}
          >
            In Transit
          </button>
          <button
            onClick={() => setActiveTab("cleared")}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition ${
              activeTab === "cleared"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "text-slate-400 hover:text-emerald-300"
            }`}
          >
            Cleared
          </button>
        </div>
      </div>

      {/* Incident List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            No incident records match this filter.
          </div>
        ) : (
          filteredItems.map(({ household, request, assignment, call, summary, urgency, topMatch }) => {
            const isOxygen = request?.oxygen ?? household.oxygen;
            const mobility = request?.mobility ?? household.mobility;
            const people = request?.people ?? household.people;
            const status = request?.status ?? household.reach;

            return (
              <div
                key={String(household.id)}
                className={`p-4 rounded-xl border transition-all ${
                  urgency === "critical"
                    ? "bg-red-950/20 border-red-600/40 shadow-md shadow-red-950/20"
                    : urgency === "high"
                    ? "bg-amber-950/15 border-amber-600/30"
                    : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                }`}
              >
                {/* Top Row: Name, Phone, Urgency Pill */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSelectVictim?.(household)}
                        className="font-bold text-sm text-slate-100 hover:text-sky-400 text-left transition flex items-center gap-1.5"
                      >
                        <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>{household.name}</span>
                      </button>
                      {household.simulated && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                          Simulated
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{household.address}</span>
                      <span className="text-slate-600">•</span>
                      <span className="font-mono text-slate-300 flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-500" />
                        {household.phone}
                      </span>
                    </div>
                  </div>

                  {/* Urgency Badge */}
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold ${
                      urgency === "critical"
                        ? "bg-red-500/20 text-red-400 border border-red-500/50 animate-pulse"
                        : urgency === "high"
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                        : urgency === "medium"
                        ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    }`}
                  >
                    {urgency}
                  </span>
                </div>

                {/* Medical & Assistance Badges */}
                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  {isOxygen && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg bg-red-500/20 text-red-300 font-bold border border-red-500/40">
                      <HeartPulse className="w-3 h-3 text-red-400 animate-pulse" />
                      Oxygen Dependent
                    </span>
                  )}
                  {mobility === "bedbound" && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/40">
                      Stretcher Required
                    </span>
                  )}
                  {mobility === "wheelchair" && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40">
                      <Accessibility className="w-3 h-3 text-amber-400" />
                      Wheelchair Accessible
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300">
                    <Users className="w-3 h-3 text-slate-400" />
                    {people} Occupants
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-lg bg-slate-800 text-slate-400 font-mono">
                    Status: <span className="text-slate-200 capitalize">{status}</span>
                  </span>
                </div>

                {/* AI Emergency Briefing Card */}
                <div className="mt-3 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 text-xs">
                  <div className="flex items-center gap-1.5 text-sky-400 font-semibold text-[11px] mb-1">
                    <Sparkles className="w-3 h-3 text-sky-400" />
                    <span>AI Emergency Dispatch Summary:</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11.5px]">
                    {summary}
                  </p>
                </div>

                {/* Graph Matching: Closest Capable Dispatcher */}
                {topMatch && (
                  <div className="mt-3 p-2.5 rounded-lg bg-sky-950/30 border border-sky-800/40 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Navigation className="w-4 h-4 text-sky-400 shrink-0" />
                      <div>
                        <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                          <span>Closest Unit: {topMatch.vehicle.name}</span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({topMatch.vehicle.driverName})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {topMatch.distanceMiles} miles away • ~{topMatch.etaMinutes} min response time
                        </div>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                        topMatch.canServe
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-red-500/20 text-red-300"
                      }`}
                    >
                      {topMatch.canServe ? "Vehicle Equipped" : "Capacity Limit"}
                    </span>
                  </div>
                )}

                {/* Card Action Controls */}
                <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                  <button
                    onClick={() => onOpenTranscript(household, call, request)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                  >
                    <FileText className="w-3.5 h-3.5 text-sky-400" />
                    <span>View Call Transcript</span>
                  </button>

                  <div className="flex items-center gap-2">
                    {/* Action depending on request & assignment state */}
                    {assignment?.status === "offered" ? (
                      <>
                        <button
                          onClick={() => onAcceptOffer(assignment.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Accept Mission</span>
                        </button>
                        <button
                          onClick={() => onDeclineOffer(assignment.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-red-400 text-xs transition"
                        >
                          Decline
                        </button>
                      </>
                    ) : assignment?.status === "accepted" ? (
                      <button
                        onClick={() => request && onCloseRequest(request.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-white text-xs font-semibold transition"
                      >
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>Mark Rescued</span>
                      </button>
                    ) : topMatch && request ? (
                      <button
                        onClick={() => onDispatchClosest(request.id, topMatch.vehicle.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md shadow-sky-950/40 transition"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Dispatch {topMatch.vehicle.name}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
