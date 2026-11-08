import React, { useEffect, useRef } from "react";
import { directionsMapUrl } from "../../../shared/directions-map";
import { SPACETIME_DATABASE, SPACETIME_URI } from "../../../shared/spacetime";
import { validIncidentPoint, type IncidentPoint } from "../../../shared/incident";

export type EditMode = "none" | "zone" | "closure";
export function IncidentMap({ mode, vertices, closures, homes, onPoint }: {
  mode: EditMode; vertices: readonly IncidentPoint[]; closures: readonly (IncidentPoint & { street: string })[];
  homes: readonly (IncidentPoint & { id: bigint; name: string })[]; onPoint: (mode: EditMode, point: IncidentPoint) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef({ mode, vertices, closures, homes, onPoint });
  current.current = { mode, vertices, closures, homes, onPoint };
  const url = directionsMapUrl(import.meta.env?.VITE_MAP_URL, typeof window === "undefined" ? "http://localhost:3001/" : window.location.href,
    import.meta.env?.VITE_SPACETIME_URI || SPACETIME_URI, import.meta.env?.VITE_SPACETIME_DATABASE || SPACETIME_DATABASE);
  const mapOrigin = new URL(url).origin;
  const send = () => {
    const c = current.current;
    frame.current?.contentWindow?.postMessage({ type: "dialevac:incident-editor", mode: c.mode, vertices: c.vertices, closures: c.closures }, mapOrigin);
  };
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== mapOrigin) return;
      if (event.data?.type === "dialevac:ready") {
        const cases = current.current.homes.filter(validIncidentPoint).map(h => ({ ...h, id: String(h.id), label: h.name, severity: "medium" }));
        frame.current?.contentWindow?.postMessage({ type: "dialevac:cases", cases }, mapOrigin);
        send();
      }
      if (event.data?.type === "dialevac:incident-point" && event.data.mode === current.current.mode && validIncidentPoint(event.data.point)) current.current.onPoint(current.current.mode, event.data.point);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mapOrigin]);
  useEffect(send, [mapOrigin, mode, vertices, closures]);
  return <div style={{ position: "relative", height: 500, minHeight: 360, border: "1px solid #3a465a", borderRadius: 14, overflow: "hidden" }}>
    <iframe ref={frame} src={url} onLoad={send} title="Incident boundary and road closure editor" style={{ width: "100%", height: "100%", border: 0 }} />
    <div role="status" style={{ position: "absolute", top: 12, left: 12, right: 48, pointerEvents: "none", padding: "8px 12px", borderRadius: 8, background: "rgba(13,20,33,.92)", color: "#f5f5f6", fontSize: 12 }}>
      {mode === "zone" ? `Click to add boundary corners · ${vertices.length} corners` : mode === "closure" ? "Click the road location, then enter its name and save the closure" : "Choose Draw boundary or Mark closure to edit the map"}
    </div>
  </div>;
}
