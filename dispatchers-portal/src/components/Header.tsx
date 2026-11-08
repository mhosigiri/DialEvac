import React from "react";
import {
  ShieldAlert,
  Radio,
  Ambulance,
  HeartPulse,
  Users,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import type { Zone, Coverage } from "../module_bindings/types";

interface HeaderProps {
  zone?: Zone;
  coverage?: Coverage;
  connected: boolean;
  activeRescuesCount: number;
  criticalCount: number;
  onRefresh?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  zone,
  coverage,
  connected,
  activeRescuesCount,
  criticalCount,
  onRefresh,
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-6 py-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Brand & Disaster Event Title */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-600/20 border border-red-500/40 text-red-500 rounded-xl shadow-lg shadow-red-950/50">
            <ShieldAlert className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg text-slate-100 tracking-tight">
                Emergency Dispatch Portal
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
                  connected
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    connected ? "bg-emerald-400 animate-ping" : "bg-amber-400"
                  }`}
                />
                {connected ? "SpacetimeDB Live" : "Connecting..."}
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span>EOC Incident Commander System</span>
              <span className="text-slate-600">•</span>
              <span className="text-amber-400 font-medium">
                {zone?.name || "Active Hazard: Houston Hurricane / Tornado Zone"}
              </span>
            </p>
          </div>
        </div>

        {/* Real-time Triage Counters */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs font-medium">
          {/* Critical Medical */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-500/30 text-red-300">
            <HeartPulse className="w-4 h-4 text-red-400 animate-bounce" />
            <div>
              <div className="text-[10px] text-red-400/80 uppercase tracking-wider">Critical Medical</div>
              <div className="text-sm font-bold text-red-200">{criticalCount} urgent</div>
            </div>
          </div>

          {/* Active Rescues */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-950/40 border border-sky-500/30 text-sky-300">
            <Ambulance className="w-4 h-4 text-sky-400" />
            <div>
              <div className="text-[10px] text-sky-400/80 uppercase tracking-wider">Rescues Active</div>
              <div className="text-sm font-bold text-sky-200">{activeRescuesCount} in transit</div>
            </div>
          </div>

          {/* Households in Zone */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300">
            <Users className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">In Hazard Zone</div>
              <div className="text-sm font-bold text-slate-100">{coverage?.inZone ?? 13} homes</div>
            </div>
          </div>

          {/* Helped / Evacuated */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-[10px] text-emerald-400/80 uppercase tracking-wider">Helped</div>
              <div className="text-sm font-bold text-emerald-200">
                {(coverage?.helped ?? 0) + (coverage?.leavingOnOwn ?? 0)} cleared
              </div>
            </div>
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh connection"
              className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
