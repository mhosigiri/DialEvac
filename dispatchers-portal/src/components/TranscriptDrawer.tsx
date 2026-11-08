import React from "react";
import { X, PhoneCall, Bot, User, Clock, AlertTriangle } from "lucide-react";
import type { Household, Call, TranscriptLine, Request } from "../module_bindings/types";

interface TranscriptDrawerProps {
  household?: Household;
  request?: Request;
  call?: Call;
  transcripts: readonly TranscriptLine[];
  onClose: () => void;
}

export const TranscriptDrawer: React.FC<TranscriptDrawerProps> = ({
  household,
  request,
  call,
  transcripts,
  onClose,
}) => {
  if (!household) return null;

  const relevantTranscripts = transcripts
    .filter((t) => call ? t.callId === call.id : true)
    .sort((a, b) => Number(a.at.toMillis() - b.at.toMillis()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>Emergency Call Transcript</span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {household.phone}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {household.name} • {household.address}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Triage Status Strip */}
        <div className="px-5 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex flex-wrap items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500">Call Status:</span>{" "}
            <span className="font-semibold text-emerald-400 capitalize">
              {call?.phase || "completed"}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Mobility:</span>{" "}
            <span className="font-semibold text-amber-300 capitalize">
              {request?.mobility || household.mobility}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Oxygen Dependency:</span>{" "}
            <span
              className={`font-semibold ${
                (request?.oxygen ?? household.oxygen) ? "text-red-400 font-bold" : "text-slate-300"
              }`}
            >
              {(request?.oxygen ?? household.oxygen) ? "YES (Required)" : "No"}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Occupants:</span>{" "}
            <span className="font-semibold text-slate-200">
              {request?.people || household.people}
            </span>
          </div>
        </div>

        {/* Transcript Turn Stream */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {relevantTranscripts.length === 0 ? (
            <div className="text-center py-12 text-slate-500 flex flex-col items-center gap-2">
              <Clock className="w-8 h-8 text-slate-600 animate-spin" />
              <p className="text-sm">
                No recorded utterances yet for this call.
              </p>
              <p className="text-xs text-slate-600">
                Live lines are streamed by the Claude / ElevenLabs voice service into SpacetimeDB.
              </p>
            </div>
          ) : (
            relevantTranscripts.map((t, idx) => {
              const isAgent = t.speaker.toLowerCase().includes("agent") || t.speaker.toLowerCase().includes("ai") || t.speaker.toLowerCase().includes("system");
              return (
                <div
                  key={idx}
                  className={`flex gap-3 text-sm ${
                    isAgent ? "flex-row" : "flex-row-reverse"
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-semibold ${
                      isAgent
                        ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                        : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    }`}
                  >
                    {isAgent ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                  </div>

                  {/* Speech Bubble */}
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                      isAgent
                        ? "bg-slate-800/90 text-slate-200 border border-slate-700/60 rounded-tl-none"
                        : "bg-emerald-950/40 text-emerald-100 border border-emerald-600/30 rounded-tr-none"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {isAgent ? "Emergency AI Agent" : household.name}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(Number(t.at.toMillis())).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="leading-relaxed whitespace-pre-wrap">{t.text}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5 text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            <span>AI triage summary validated with caller</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
};
