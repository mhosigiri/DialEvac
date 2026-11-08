import React from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title: string;
  detail?: string;
  icon?: React.ReactNode;
}

/** Quiet placeholder for an empty queue, filter result or panel. */
export const EmptyState: React.FC<EmptyStateProps> = ({ title, detail, icon }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
      gap: 8,
      padding: "28px 20px",
      fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    }}
  >
    <span
      aria-hidden
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        background: "#1a1a1f",
        border: "1px solid #26262c",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#9a9aa0",
      }}
    >
      {icon ?? <Inbox size={18} />}
    </span>
    <span style={{ fontSize: 14, fontWeight: 600, color: "#f5f5f6" }}>
      {title}
    </span>
    {detail && (
      <span
        style={{
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "#9a9aa0",
          maxWidth: 340,
        }}
      >
        {detail}
      </span>
    )}
  </div>
);
