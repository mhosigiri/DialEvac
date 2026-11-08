import React from "react";
import { OctagonAlert, X } from "lucide-react";

interface NoticeProps {
  message: string;
  onDismiss: () => void;
}

/** A failed dispatcher action. Stays until dismissed so it can't be missed mid-incident. */
export const Notice: React.FC<NoticeProps> = ({ message, onDismiss }) => (
  <div
    role="alert"
    className="fixed bottom-5 right-5 z-[2000] flex items-start gap-3"
    style={{
      maxWidth: 420,
      padding: "12px 12px 12px 14px",
      borderRadius: "12px",
      background: "#1a1a1f",
      border: "1px solid rgb(248 113 113 / 35%)",
      borderLeft: "4px solid #f87171",
      boxShadow: "0 16px 48px rgb(0 0 0 / 55%)",
      color: "#f5f5f6",
      fontSize: 13,
      lineHeight: 1.45,
      fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    }}
  >
    <OctagonAlert
      size={16}
      strokeWidth={2.5}
      aria-hidden
      style={{
        color: "#f87171",
        flexShrink: 0,
        marginTop: 1,
      }}
    />
    <span style={{ flex: 1 }}>
      <strong style={{ display: "block", fontSize: 12.5 }}>
        Action failed
      </strong>
      <span style={{ color: "#c2c2c9" }}>{message}</span>
    </span>
    <button
      onClick={onDismiss}
      aria-label="Dismiss"
      style={{
        background: "none",
        border: "1px solid transparent",
        borderRadius: 8,
        color: "#9a9aa0",
        cursor: "pointer",
        padding: 4,
        flexShrink: 0,
        lineHeight: 0,
      }}
    >
      <X className="w-4 h-4" />
    </button>
  </div>
);
