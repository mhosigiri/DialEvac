import React from "react";
import { LayoutGrid, Ambulance, Map as MapIcon, Columns3, PhoneCall, RadioTower, Radio } from "lucide-react";
import logoImg from "../assets/logo.png";

export type PortalView = "operations" | "queue" | "fleet" | "map" | "calls" | "incident" | "outreach";

interface SidebarProps {
  view: PortalView;
  onChange: (view: PortalView) => void;
  connected: boolean;
}

const ITEMS: { id: PortalView; label: string; icon: React.ReactNode }[] = [
  { id: "operations", label: "Overview", icon: <LayoutGrid style={{ width: 22, height: 22 }} strokeWidth={1.8} /> },
  { id: "queue", label: "Queue", icon: <Columns3 style={{ width: 22, height: 22 }} strokeWidth={1.8} /> },
  { id: "outreach", label: "Outreach", icon: <Radio style={{ width: 22, height: 22 }} strokeWidth={1.8} /> },
  { id: "calls", label: "Calls", icon: <PhoneCall style={{ width: 22, height: 22 }} strokeWidth={1.8} /> },
  { id: "fleet", label: "Fleet", icon: <Ambulance style={{ width: 22, height: 22 }} strokeWidth={1.8} /> },
  { id: "map", label: "Map", icon: <MapIcon style={{ width: 22, height: 22 }} strokeWidth={1.8} /> },
  { id: "incident", label: "Incident", icon: <RadioTower style={{ width: 22, height: 22 }} strokeWidth={1.8} /> },
];

/** Icon rail: white logo tile + wordmark, outline nav, active pill, link state at the bottom. */
export const Sidebar: React.FC<SidebarProps> = ({ view, onChange, connected }) => (
  <nav
    aria-label="Portal sections"
    className="flex flex-col items-center gap-1 py-4 px-2 shrink-0 self-stretch eoc-rail"
    style={{ width: 112, margin: 12, background: "#0c0c0e", border: "1px solid #26262c", borderRadius: 20 }}
  >
    <div
      className="flex items-center justify-center overflow-hidden eoc-rail-logo"
      style={{ width: 44, height: 44, borderRadius: 14, background: "#ffffff", padding: 2 }}
      title="DialEvac Emergency Dispatch"
    >
      <img
        src={logoImg}
        alt="DialEvac"
        style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 12 }}
      />
    </div>
    <div
      className="text-center font-semibold eoc-rail-wordmark"
      style={{ fontSize: 13, color: "#f5f5f6", marginTop: 8, marginBottom: 22, letterSpacing: "-0.01em" }}
    >
      dispatch
    </div>

    {ITEMS.map((item) => {
      const active = item.id === view;
      return (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          aria-current={active ? "page" : undefined}
          aria-label={item.label}
          className="flex flex-col items-center gap-1.5 eoc-rail-item"
          style={{
            width: 88,
            padding: "10px 0 9px",
            borderRadius: 12,
            background: active ? "#1e1e22" : "transparent",
            color: active ? "#f5f5f6" : "#9a9aa0",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: active ? 600 : 500,
          }}
        >
          {item.icon}
          <span className="eoc-rail-label">{item.label}</span>
        </button>
      );
    })}

    <div style={{ flex: 1 }} />
    <div
      className="flex flex-col items-center gap-1.5"
      title={connected ? "SpacetimeDB live" : "Connecting"}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: connected ? "#3dd68c" : "#e8b84b",
        }}
      />
      <span style={{ fontSize: 9, color: "#9a9aa0" }}>
        {connected ? "Live" : "Sync"}
      </span>
    </div>
  </nav>
);

export function portalViewFromSearch(search: string): PortalView {
  const params = new URLSearchParams(search);
  if (params.has("demo")) return "outreach";
  return ITEMS.find(item => item.id === params.get("view"))?.id ?? "operations";
}
