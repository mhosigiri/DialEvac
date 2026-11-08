import React, { useEffect, useRef } from "react";
import { bindDirectionsMap, directionsMapUrl, type MapPoint } from "../../../shared/directions-map";
import { SPACETIME_DATABASE, SPACETIME_URI } from "../../../shared/spacetime";

export function DirectionsMap({ origin, destination, points, summary, model }: {
  origin: MapPoint; destination: MapPoint; points: readonly MapPoint[]; summary?: string; model?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const url = directionsMapUrl(import.meta.env?.VITE_MAP_URL,
    typeof window === "undefined" ? "http://localhost:3001/" : window.location.href,
    import.meta.env?.VITE_SPACETIME_URI || SPACETIME_URI, import.meta.env?.VITE_SPACETIME_DATABASE || SPACETIME_DATABASE);
  useEffect(() => frame.current ? bindDirectionsMap(frame.current, { origin, destination, points, coveredBottom: summary ? 120 : 0 }) : undefined,
    [url, origin.lat, origin.lng, origin.label, destination.lat, destination.lng, destination.label, points, summary]);
  return <div aria-label="In-app OpenStreetMap directions" style={{ position: "relative", height: 420, marginTop: 12, borderRadius: 12, overflow: "hidden", border: "1px solid #3a465a", background: "#08090c" }}>
    <iframe ref={frame} title="OpenStreetMap route to pickup" src={url} style={{ width: "100%", height: "100%", border: 0 }} />
    {summary && <aside aria-label="Gemini map overlay" style={{ position: "absolute", bottom: 26, left: 10, right: 10, padding: 10, border: "1px solid #58709a", borderRadius: 10, background: "rgba(13,20,33,.94)", color: "#f5f5f6", maxHeight: 112, overflowY: "auto" }}>
      <strong style={{ fontSize: 12 }}>Gemini route brief</strong><span style={{ fontSize: 10, marginLeft: 8, color: "#a4b4d0" }}>{model}</span>
      <p style={{ fontSize: 12, lineHeight: 1.45, margin: "5px 0 0" }}>{summary}</p>
    </aside>}
  </div>;
}
