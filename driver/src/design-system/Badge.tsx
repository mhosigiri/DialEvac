import React from "react";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: React.ReactNode;
}

const TONE: Record<BadgeTone, { bg: string; text: string; border: string }> = {
  success: { bg: "rgb(61 214 140 / 14%)", text: "#3dd68c", border: "rgb(61 214 140 / 35%)" },
  warning: { bg: "rgb(240 197 106 / 14%)", text: "#e8b84b", border: "rgb(240 197 106 / 35%)" },
  danger: { bg: "rgb(248 113 113 / 14%)", text: "#f87171", border: "rgb(248 113 113 / 35%)" },
  info: { bg: "rgb(143 176 255 / 14%)", text: "#8fb0ff", border: "rgb(143 176 255 / 35%)" },
  neutral: { bg: "#1a1a1f", text: "#c2c2c9", border: "#26262c" },
};

/** Status pill: Cleared / In review / Nearly ready / REAR candidate, etc. */
export const Badge: React.FC<BadgeProps> = ({
  tone = "neutral",
  dot = false,
  children,
}) => {
  const t = TONE[tone];
  return (
    <span
      style={{
        background: t.bg,
        color: t.text,
        border: "1px solid transparent",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "-0.005em",
        lineHeight: 1.4,
        padding: "4px 11px",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
        fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: t.text,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
};
