import React, { useCallback, useEffect, useRef, useState } from "react";
import { CardHeader } from "../design-system/Card";
import { SPACETIME_DATABASE, SPACETIME_URI } from "../../../shared/spacetime";
import { CASE_FILE_WIDTH } from "./CaseFile";

const MIN_ROUTE_FRAME_WIDTH = 280;

export interface MapSelection {
  lat: number;
  lng: number;
  label: string;
}

export interface MapCase extends MapSelection {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "cleared";
}

interface IncidentMapFrameProps {
  title?: string;
  subtitle?: string;
  height?: number | string;
  selected?: MapSelection;
  cases?: readonly MapCase[];
  route?: readonly { lat: number; lng: number }[];
  zoneGeometry?: string;
  onOpenCase?: (id: string) => void;
}

function mapUrl() {
  const base =
    import.meta.env.VITE_MAP_URL || "http://127.0.0.1:4178/index.html";
  const uri = import.meta.env.VITE_SPACETIME_URI || SPACETIME_URI;
  const db = import.meta.env.VITE_SPACETIME_DATABASE || SPACETIME_DATABASE;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}uri=${encodeURIComponent(uri)}&db=${encodeURIComponent(db)}`;
}

/**
 * Live incident map. Embeds the existing MapLibre globe in map/ (terrain,
 * live NWS warnings, fleet) in an iframe — this portal owns no map tiles,
 * polygons or markers itself.
 */
export const IncidentMapFrame: React.FC<IncidentMapFrameProps> = ({
  title = "Live incident map",
  subtitle = "Terrain · NWS warnings · fleet",
  selected,
  cases,
  route,
  zoneGeometry,
  onOpenCase,
}) => {
  const url = mapUrl();
  const base = url.split("?")[0];
  const frame = useRef<HTMLIFrameElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const casesRef = useRef(cases);
  casesRef.current = cases;
  const routeRef = useRef(route);
  routeRef.current = route;
  const zoneRef = useRef(zoneGeometry);
  zoneRef.current = zoneGeometry;
  const mapOrigin = new URL(base, window.location.href).origin;

  const sendSelection = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "dialevac:select", selection: selectedRef.current ?? null }, mapOrigin);
  }, [mapOrigin]);

  const sendCases = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "dialevac:cases", cases: casesRef.current ?? [] }, mapOrigin);
  }, [mapOrigin]);

  const sendRoute = useCallback(() => {
    const box = frame.current?.getBoundingClientRect();
    const covered = box ? Math.max(0, box.right - (window.innerWidth - CASE_FILE_WIDTH)) : 0;
    // A route only shows with its case file open, so the trip is framed in the part of the map left visible.
    const coveredRight = box && box.width - covered >= MIN_ROUTE_FRAME_WIDTH ? covered : 0;
    frame.current?.contentWindow?.postMessage({ type: "dialevac:route", points: routeRef.current ?? null, coveredRight }, mapOrigin);
  }, [mapOrigin]);

  const sendZone = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "dialevac:zone", geometry: zoneRef.current ?? null }, mapOrigin);
  }, [mapOrigin]);

  useEffect(sendCases, [sendCases, cases]);
  useEffect(sendZone, [sendZone, zoneGeometry]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== mapOrigin || e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === "dialevac:open-case" && typeof e.data.id === "string") onOpenCase?.(e.data.id);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mapOrigin, onOpenCase]);

  // Selection first, so a route that is already ready frames the whole trip rather than the home alone.
  useEffect(sendSelection, [sendSelection, selected?.lat, selected?.lng, selected?.label]);
  useEffect(sendRoute, [sendRoute, route]);

  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(true);

  const probe = useCallback(() => {
    setChecking(true);
    setFailed(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    fetch(base, { mode: "no-cors", signal: controller.signal })
      .then(() => {
        window.clearTimeout(timer);
        setChecking(false);
      })
      .catch(() => {
        window.clearTimeout(timer);
        setChecking(false);
        setFailed(true);
      });
  }, [base]);

  useEffect(() => {
    probe();
  }, [probe]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#8fb0ff",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Open full map ↗
          </a>
        }
      />
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 240,
          borderRadius: "12px",
          overflow: "hidden",
          border: "1px solid #26262c",
          background: "#060607",
        }}
      >
        {failed ? (
          <div
            role="alert"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 24,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 650, color: "#f5f5f6" }}>
              Map unavailable
            </div>
            <div style={{ fontSize: 12.5, color: "#c2c2c9", overflowWrap: "anywhere" }}>
              Could not reach the map server at {base}. Start it with{" "}
              <code>cd map &amp;&amp; npm run serve</code>, then retry.
            </div>
            <button
              onClick={probe}
              style={{
                marginTop: 4,
                minHeight: "32px",
                padding: "0 14px",
                borderRadius: "12px",
                background: "#1a1a1f",
                color: "#f5f5f6",
                border: "1px solid #2e2e36",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
              }}
            >
              {checking ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : (
          <iframe
            title="Live incident map (terrain, NWS warnings, fleet)"
            ref={frame}
            src={`${url}&embed=1`}
            onLoad={() => {
              sendZone();
              sendCases();
              sendSelection();
              sendRoute();
            }}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            allow="geolocation"
          />
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--ds-text-muted)", margin: "8px 0 0", lineHeight: 1.45 }}>
        Dots are the cases in this queue, colored by urgency. Select one to open it. The shaded area is the incident zone, and a blue line is a requested road route.
      </p>
    </div>
  );
};
