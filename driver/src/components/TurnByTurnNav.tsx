import React, { useEffect, useState, useRef } from "react";
import type { DispatchRoute, RouteGuidance, RoadClosure, Vehicle } from "../module_bindings/types";
import { parseRouteSteps, routeMatchesLocations, type RouteStep } from "../../../shared/route-guidance";
import { historicalReport } from "../../../shared/houston-history";
import type { DriverStop } from "../lib/driver-state";
import { formatDistance, formatDuration } from "../lib/driver-state";
import { followRoute } from "../lib/route-progress";
import { getManeuverIcon } from "../lib/navigation-icons";
import { NavigationMap } from "./NavigationMap";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";

interface TurnByTurnNavProps {
  stop: DriverStop;
  vehicle?: Vehicle;
  route?: DispatchRoute;
  guidance?: RouteGuidance;
  roadClosures: readonly RoadClosure[];
  onRequestRoute: (assignmentId: bigint) => void;
  onOpenComms?: () => void;
  busy: boolean;
}

export const TurnByTurnNav: React.FC<TurnByTurnNavProps> = ({
  stop,
  vehicle,
  route,
  guidance,
  roadClosures,
  onRequestRoute,
  onOpenComms,
  busy,
}) => {
  const [previewStepIndex, setPreviewStepIndex] = useState<number | null>(null);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const lastSpokenStep = useRef<number | null>(null);
  const mapSection = useRef<HTMLDivElement>(null);
  const origin = vehicle
    ? { lat: vehicle.lat, lng: vehicle.lng, label: vehicle.name }
    : undefined;
  const destination = { lat: stop.lat, lng: stop.lng, label: stop.residentName };
  const isRouteReady = route?.state === "ready" && route.assignmentId === stop.assignmentId && !!origin && routeMatchesLocations(route, origin, destination);
  const currentGuidance = isRouteReady && guidance?.assignmentId === stop.assignmentId && guidance.revision === route.revision ? guidance : undefined;
  const report = historicalReport(stop.riderId);
  const routeKey = `${stop.assignmentId}:${route?.revision}`;
  const lastProgress = useRef({ routeKey, meters: 0 });
  useEffect(() => {
    lastSpokenStep.current = null;
  }, [routeKey]);

  // Parse steps from guidance
  let steps: RouteStep[] = [];
  try {
    if (currentGuidance?.stepsJson) {
      steps = parseRouteSteps(JSON.parse(currentGuidance.stepsJson));
    }
  } catch {
    // Keep empty
  }

  const progress = isRouteReady && steps.length > 0
    ? followRoute([{ lat: route.originLat, lng: route.originLng }, ...route.points, destination], steps, origin, lastProgress.current.routeKey === routeKey ? lastProgress.current.meters : 0)
    : undefined;
  const liveStepIndex = progress?.stepIndex ?? 0;
  const drivenMeters = progress?.drivenMeters ?? 0;
  useEffect(() => {
    lastProgress.current = { routeKey, meters: drivenMeters };
  }, [routeKey, drivenMeters]);
  // Reaching a new step ends any preview, so the screen never hides the turn the responder is at.
  useEffect(() => setPreviewStepIndex(null), [routeKey, liveStepIndex]);

  const currentStepIndex = previewStepIndex ?? liveStepIndex;
  const previewStep = (index: number) => setPreviewStepIndex(index === liveStepIndex ? null : index);
  const currentStep = steps[currentStepIndex];
  const nextStep = steps[currentStepIndex + 1];
  const currentStepMeters = previewStepIndex === null ? progress?.metersLeftOnStep : currentStep?.distanceMeters;

  const showDirections = () => {
    mapSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setShowAllSteps(true);
    if (!isRouteReady) onRequestRoute(stop.assignmentId);
  };

  // Spoken Voice Navigation (Web Speech API like Google Maps)
  useEffect(() => {
    const liveStep = steps[liveStepIndex];
    if (!voiceEnabled || !liveStep) return;
    if (lastSpokenStep.current === liveStepIndex) return;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel(); // Stop prior speech
      const text = progress?.metersLeftOnStep
        ? `${liveStep.instruction}, for ${formatDistance(progress.metersLeftOnStep)}.`
        : `${liveStep.instruction}.`;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
      lastSpokenStep.current = liveStepIndex;
    }
  }, [liveStepIndex, voiceEnabled, routeKey, steps.length]);

  // Muting or leaving the screen must silence a prompt already being spoken.
  useEffect(() => () => window.speechSynthesis?.cancel(), [voiceEnabled]);

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4 pb-28">
      {report && <p className="text-xs text-[#a3a3aa]">{stop.address}<br />Historical flood report · {report.reportedAt.slice(0, 10)} · Case {report.caseNumber}.</p>}
      {/* Google Maps-Style High-Contrast Turn Banner */}
      <div className="bg-[#102419] border-2 border-[#3dd68c] rounded-2xl p-4 shadow-[0_8px_30px_rgba(61,214,140,0.2)] text-[#f5f5f6] space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="w-14 h-14 rounded-2xl bg-[#3dd68c] text-black flex items-center justify-center flex-none shadow-lg">
            {currentStep
              ? getManeuverIcon(currentStep.instruction, 38)
              : getManeuverIcon("straight", 38)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xl font-extrabold tracking-tight text-white leading-tight">
              {currentStep ? currentStep.instruction : `Proceed towards ${stop.address}`}
            </div>
            {!!currentStepMeters && (
              <div className="text-sm font-semibold text-[#a0dfbf] mt-1">
                for {formatDistance(currentStepMeters)}
              </div>
            )}
          </div>

          {/* Voice Mute / Unmute Toggle */}
          <button
            type="button"
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className={`p-2 rounded-xl border text-xs font-bold transition-colors ${
              voiceEnabled
                ? "bg-[#3dd68c]/20 border-[#3dd68c] text-[#3dd68c]"
                : "bg-black/30 border-white/20 text-white/50"
            }`}
            title={voiceEnabled ? "Voice guidance active" : "Voice muted"}
          >
            {voiceEnabled ? "🔊 Voice" : "🔇 Muted"}
          </button>
        </div>

        {/* Secondary Next Maneuver Preview ("Then turn left on...") */}
        {nextStep && (
          <div className="pt-2 border-t border-[#3dd68c]/25 flex items-center gap-2 text-xs text-[#a0dfbf]">
            <span className="font-semibold text-white uppercase text-[10px] tracking-wider">Then</span>
            <span className="truncate">
              {nextStep.instruction} in {formatDistance(currentStepMeters)}
            </span>
          </div>
        )}
      </div>

      {/* Interactive Map Visualizer */}
      <div ref={mapSection}><NavigationMap
        origin={origin ?? destination}
        destination={destination}
        points={isRouteReady ? route.points : []}
        steps={steps}
        currentStepIndex={currentStepIndex}
        roadClosures={roadClosures}
        summary={currentGuidance?.summary}
        model={currentGuidance?.model}
      /></div>

      {/* Step Stepper & Dispatch Comms Action Bar */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenComms}
          className="min-h-[46px] rounded-xl bg-[#1a1a1f] hover:bg-[#26262c] border border-[#2e2e36] text-[#8fb0ff] font-bold text-xs flex items-center justify-center gap-2 shadow transition-all active:scale-98"
        >
          <span>📻 Dispatch Radio / Comms</span>
        </button>

        <button
          type="button"
          onClick={showDirections}
          disabled={busy || route?.state === "pending"}
          className="min-h-[46px] rounded-xl bg-gradient-to-r from-[#1a1a1f] to-[#26262c] hover:border-[#8fb0ff] border border-[#33333a] text-[#f5f5f6] font-bold text-xs flex items-center justify-center gap-1.5 shadow active:scale-98 transition-all"
        >
          <span>Get directions</span>
        </button>
      </div>

      {/* Google Maps Bottom Trip Dashboard (ETA, Rem. Distance, Speed) */}
      <div className="bg-[#131316] border border-[#26262c] rounded-2xl p-4 shadow-xl space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[11px] font-semibold text-[#a3a3aa] uppercase tracking-wider">Drive Time</div>
            <div className="text-xl font-extrabold text-[#3dd68c] mt-0.5">
              {formatDuration(isRouteReady ? route.durationSeconds : undefined)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#a3a3aa] uppercase tracking-wider">Distance</div>
            <div className="text-xl font-extrabold text-[#f5f5f6] mt-0.5">
              {formatDistance(isRouteReady ? route.distanceMeters : undefined)}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#a3a3aa] uppercase tracking-wider">Turns</div>
            <div className="text-xl font-extrabold text-[#8fb0ff] mt-0.5">
              {steps.length > 0 ? `${currentStepIndex + 1}/${steps.length}` : "--"}
            </div>
          </div>
        </div>

        {/* Step Forward / Backward Taps */}
        {steps.length > 1 && (
          <div className="pt-2 border-t border-[#26262c] flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={currentStepIndex === 0}
              onClick={() => previewStep(currentStepIndex - 1)}
              className="flex-1 py-2 rounded-xl bg-[#1a1a1f] text-xs font-bold text-[#c2c2c9] disabled:opacity-30 border border-[#26262c]"
            >
              ← Prior Turn
            </button>
            {previewStepIndex === null ? (
              <span className="text-xs text-[#a3a3aa] font-mono px-2">
                Turn {currentStepIndex + 1}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => previewStep(liveStepIndex)}
                className="text-xs text-[#8fb0ff] font-bold px-2"
              >
                Back to current turn
              </button>
            )}
            <button
              type="button"
              disabled={currentStepIndex >= steps.length - 1}
              onClick={() => previewStep(currentStepIndex + 1)}
              className="flex-1 py-2 rounded-xl bg-[#1a1a1f] text-xs font-bold text-[#c2c2c9] disabled:opacity-30 border border-[#26262c]"
            >
              Next Turn →
            </button>
          </div>
        )}
      </div>

      {/* Route Missing / Refresh Trigger */}
      {(
        <div className="bg-[#1a1a1f] border border-[#2e2e36] rounded-xl p-3.5 flex items-center justify-between gap-3">
          <div className="text-xs text-[#a3a3aa]">
            {route?.state === "pending"
              ? "OSMnx router calculating road path avoiding active closures..."
              : isRouteReady ? "Road directions from the responder to this address." : "Get a current road route to this address."}
          </div>
          <button
            type="button"
            disabled={busy || route?.state === "pending"}
            onClick={() => onRequestRoute(stop.assignmentId)}
            className="px-3 py-1.5 rounded-lg bg-[#8fb0ff] text-black font-bold text-xs flex-none"
          >
            {route?.state === "pending" ? "Routing..." : isRouteReady ? "Refresh directions" : "Calculate road route"}
          </button>
        </div>
      )}

      {/* Step-by-Step Directions Drawer */}
      {steps.length > 0 && (
        <div className="bg-[#131316] border border-[#26262c] rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAllSteps(!showAllSteps)}
            className="w-full px-4 py-3 flex items-center justify-between text-left text-sm font-bold text-[#f5f5f6] hover:bg-[#1a1a1f] transition-colors"
          >
            <span>Driving Directions ({steps.length} turns)</span>
            <span className="text-xs text-[#8fb0ff]">{showAllSteps ? "Hide ▲" : "Show ▼"}</span>
          </button>

          {showAllSteps && (
            <div className="border-t border-[#26262c] divide-y divide-[#1e1e24] max-h-72 overflow-y-auto no-scrollbar">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  onClick={() => previewStep(idx)}
                  className={`p-3 text-xs flex items-center gap-3 cursor-pointer transition-colors ${
                    idx === currentStepIndex
                      ? "bg-[#8fb0ff]/10 text-white font-semibold"
                      : "text-[#c2c2c9] hover:bg-[#1a1a1f]"
                  }`}
                >
                  <div className="w-6 text-center text-[#8fb0ff] font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1 leading-snug">
                    <div>{step.instruction}</div>
                    {step.road && (
                      <div className="text-[11px] text-[#a3a3aa] mt-0.5">{step.road}</div>
                    )}
                  </div>
                  <div className="text-right text-[11px] text-[#a3a3aa] font-mono flex-none">
                    {formatDistance(step.distanceMeters)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Destination Card & Resident Call Button */}
      <div className="bg-[#131316] border border-[#26262c] rounded-2xl p-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#a3a3aa]">
            Target Evacuation Stop
          </div>
          <div className="text-sm font-bold text-[#f5f5f6] mt-0.5">{stop.residentName}</div>
          <div className="text-xs text-[#c2c2c9] truncate max-w-[220px]">{stop.address}</div>
        </div>

        {stop.phone && (
          <a
            href={`tel:${stop.phone}`}
            className="px-3.5 py-2 rounded-xl bg-[#3dd68c]/20 border border-[#3dd68c]/40 text-[#3dd68c] font-bold text-xs flex items-center gap-1.5 flex-none"
          >
            <span>📞 Call</span>
          </a>
        )}
      </div>
    </div>
  );
};
