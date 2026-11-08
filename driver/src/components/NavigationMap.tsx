import React, { useEffect, useRef } from "react";
import type { RouteStep } from "../../../shared/route-guidance";
import type { RoadClosure } from "../module_bindings/types";
import { bindDirectionsMap, directionsMapUrl, type MapPoint } from "../../../shared/directions-map";
import { SPACETIME_DEMO_DATABASE, SPACETIME_URI } from "../../../shared/spacetime";

interface NavigationMapProps {
  origin: MapPoint;
  destination: MapPoint;
  points: readonly MapPoint[];
  steps?: readonly RouteStep[];
  currentStepIndex?: number;
  roadClosures?: readonly RoadClosure[];
  summary?: string;
  model?: string;
}

export const NavigationMap: React.FC<NavigationMapProps> = ({ origin, destination, points, steps, currentStepIndex = 0, summary, model }) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const url = directionsMapUrl(import.meta.env?.VITE_MAP_URL,
    typeof window === "undefined" ? "http://localhost:3003/" : window.location.href,
    import.meta.env?.VITE_SPACETIME_URI || SPACETIME_URI,
    import.meta.env?.VITE_SPACETIME_DATABASE || SPACETIME_DEMO_DATABASE);
  useEffect(() => frame.current ? bindDirectionsMap(frame.current, { origin, destination, points, coveredBottom: summary ? 120 : 0 }) : undefined,
    [url, origin.lat, origin.lng, origin.label, destination.lat, destination.lng, destination.label, points, summary]);
  const step = steps?.[currentStepIndex];
  return <div aria-label="In-app OpenStreetMap directions" className="relative w-full h-[440px] bg-[#08090c] rounded-2xl border border-[#26262c] overflow-hidden shadow-2xl">
    <iframe ref={frame} title="OpenStreetMap driving navigation" src={url} className="w-full h-full border-0" />
    <div className="absolute top-3 left-3 right-12 rounded-lg border border-[#3a465a] bg-[#0d1421]/95 px-3 py-2 text-xs text-[#f5f5f6] pointer-events-none">
      {points.length >= 2 ? "OSMnx road route" : "Waiting for a road route"}{step ? ` · ${step.instruction}` : ""}
    </div>
    {summary && <aside aria-label="Gemini map overlay" className="absolute bottom-7 left-3 right-3 max-h-28 overflow-y-auto rounded-xl border border-[#58709a] bg-[#0d1421]/95 p-3 text-[#f5f5f6]">
      <div className="flex items-center justify-between gap-2"><strong className="text-xs">Gemini route brief</strong><span className="text-[10px] text-[#a4b4d0]">{model}</span></div>
      <p className="text-xs leading-relaxed mt-1">{summary}</p>
    </aside>}
  </div>;
};
