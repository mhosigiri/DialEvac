import React from "react";
import { CircleCheck } from "lucide-react";

export type CaseSeverity = "critical" | "high" | "doorcheck" | "medium" | "low";

interface CaseCardProps {
  severity: CaseSeverity;
  resolved?: boolean;
  selected?: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  badges?: React.ReactNode;
  summary?: React.ReactNode;
  match?: React.ReactNode;
  actions?: React.ReactNode;
  /** Full-width content below the summary: match details, action rows. */
  footer?: React.ReactNode;
  onSelect?: () => void;
}

const SEVERITY_WORD: Record<CaseSeverity, string> = {
  critical: "Critical",
  high: "High",
  doorcheck: "Door check",
  medium: "Medium",
  low: "Low",
};

/** Rising signal bars, like the reference priority pill. */
const SignalBars: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
    <rect x="1" y="7.5" width="2" height="3.5" rx="0.75" />
    <rect x="4" y="5" width="2" height="6" rx="0.75" />
    <rect x="7" y="2.5" width="2" height="8.5" rx="0.75" />
    <rect x="10" y="0.5" width="2" height="10" rx="0.75" />
  </svg>
);

/**
 * One dispatch case in the queue. Reference anatomy: filled severity pill
 * with signal bars, then the account status, the name on its own line in
 * larger regular type, one muted subtitle line, then the action row.
 * Severity reads without color — the word plus the bars icon.
 */
export const CaseCard: React.FC<CaseCardProps> = ({
  severity,
  resolved = false,
  selected = false,
  title,
  subtitle,
  meta,
  badges,
  summary,
  match,
  actions,
  footer,
  onSelect,
}) => {
  const tone: CaseSeverity = resolved ? "low" : severity;
  const SEVERITY_TONE: Record<CaseSeverity, { bg: string; text: string }> = {
    critical: { bg: "rgb(248 113 113 / 14%)", text: "#f87171" },
    high: { bg: "rgb(240 197 106 / 14%)", text: "#e8b84b" },
    doorcheck: { bg: "rgb(196 166 255 / 14%)", text: "#c4a6ff" },
    medium: { bg: "rgb(143 176 255 / 14%)", text: "#8fb0ff" },
    low: { bg: "#1a1a1f", text: "#c2c2c9" },
  };
  const { bg, text } = SEVERITY_TONE[tone];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onSelect) return;
    if (e.key === "Enter" || e.key === " ") {
      // Let nested buttons/links handle their own keys.
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, [role='tab']")) return;
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      aria-label={onSelect && typeof title === "string" ? `${SEVERITY_WORD[severity]} case: ${title}` : undefined}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      style={{
        position: "relative",
        flexShrink: 0,
        background: selected ? "#1c1c22" : "var(--ds-surface-raised)",
        border: `1px solid ${selected ? "#8fb0ff" : "var(--ds-border)"}`,
        borderRadius: "var(--ds-radius-card)",
        padding: "14px",
        overflow: "hidden",
        cursor: onSelect ? "pointer" : "default",
        fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        // NOTE: no inline box-shadow here — the global :focus-visible ring
        // in index.css must win for keyboard focus. Selected state uses
        // outline so the two can coexist.
        outline: selected
          ? "2px solid #8fb0ff"
          : "none",
        outlineOffset: -2,
      }}
    >
      <div style={{ opacity: resolved ? 0.78 : 1 }}>
        {/* Pills row: priority with signal bars, then every required safety/status badge. */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {resolved ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
                color: "#9a9aa0",
                background: "#1a1a1f",
                border: "1px solid transparent",
                borderRadius: 999,
                padding: "5px 12px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <CircleCheck size={12} aria-hidden />
              Closed
            </span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: text,
                background: bg,
                border: "1px solid transparent",
                borderRadius: 999,
                padding: "5px 12px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <SignalBars size={12} />
              {SEVERITY_WORD[severity]}
            </span>
          )}
          {badges}
        </div>

        {/* Name on its own line, in larger regular type. Wraps, never clips. */}
        <div
          style={{
            marginTop: 8,
            fontSize: 16,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            lineHeight: 1.35,
            color: resolved ? "#c2c2c9" : "#f5f5f6",
            overflowWrap: "anywhere",
          }}
          title={typeof title === "string" ? title : undefined}
        >
          {title}
        </div>

        {subtitle && (
          <div
            style={{
              marginTop: 2,
              fontSize: 12.5,
              lineHeight: 1.45,
              color: "var(--ds-text-muted)",
              overflowWrap: "anywhere",
            }}
          >
            {subtitle}
          </div>
        )}

        {(meta || match) && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              fontSize: 12.5,
              color: "#c2c2c9",
            }}
          >
            {meta}
            {match && (
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                {match}
              </span>
            )}
          </div>
        )}

        {summary && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--ds-text-secondary)",
              overflowWrap: "anywhere",
            }}
          >
            {summary}
          </div>
        )}

        {(footer || actions) && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {footer}
            {actions && (
              <div style={{ display: "flex", alignItems: "stretch", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                {actions}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
