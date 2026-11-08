import React from "react";
import { OctagonAlert, CircleCheck } from "lucide-react";
import type { BadgeTone } from "./Badge";

export interface CoverageSegment {
  key: string;
  label: string;
  value: number;
  tone: BadgeTone;
}

interface CoverageBarProps {
  segments: CoverageSegment[];
  total: number;
  activeKey?: string;
  onSelect?: (key: string) => void;
  /** Compact header mode: bar plus a one-line promise, no legend list. */
  compact?: boolean;
}

const TONE_BAR: Record<BadgeTone, string> = {
  success: "#3dd68c",
  warning: "#e8b84b",
  danger: "#f87171",
  info: "#8fb0ff",
  neutral: "#9a9aa0",
};

/**
 * Zone coverage: every home accounted for. Proportional bar plus labelled
 * counts; zero-value segments stay in the legend. The overlooked segment is
 * the product promise — alarming when above zero, calm when zero.
 */
export const CoverageBar: React.FC<CoverageBarProps> = ({
  segments,
  total,
  activeKey,
  onSelect,
  compact = false,
}) => {
  const alertSeg =
    segments.find((s) => s.key === "overlooked") ??
    segments.find((s) => s.tone === "danger");
  const alertCount = alertSeg?.value ?? 0;
  // Overlooked homes are not accounted for: they are found with nobody
  // reaching them and put back on the outreach ladder.
  const accounted = segments.reduce(
    (n, s) => n + (s.key === alertSeg?.key ? 0 : s.value),
    0,
  );

  return (
    <div style={{ fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 12.5, color: "#c2c2c9" }}>
          Coverage · {total} {total === 1 ? "home" : "homes"} in zone
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "#f5f5f6",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {accounted} of {total} accounted
        </span>
      </div>

      {/* Proportional bar */}
      <div
        role="group"
        aria-label="Coverage by status"
        style={{
          display: "flex",
          height: 12,
          borderRadius: 999,
          overflow: "hidden",
          background: "#2e2e36",
          border: "1px solid #26262c",
        }}
      >
        {segments.map((s) => {
          if (s.value <= 0 || total <= 0) return null;
          const active = s.key === activeKey;
          return (
            <button
              key={s.key}
              type="button"
              aria-label={`${s.label}: ${s.value}`}
              aria-pressed={active}
              onClick={() => onSelect?.(s.key)}
              title={`${s.label}: ${s.value}`}
              style={{
                width: `${Math.max((s.value / total) * 100, 2)}%`,
                minWidth: 6,
                background: TONE_BAR[s.tone],
                border: "none",
                borderRight: "2px solid #060607",
                padding: 0,
                cursor: onSelect ? "pointer" : "default",
                outline: active ? "2px solid #f5f5f6" : "none",
                outlineOffset: -2,
              }}
            />
          );
        })}
      </div>

      {/* Legend: every segment listed, zeros included. Hidden in compact. */}
      {!compact && (
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 5,
        }}
      >
        {segments.map((s) => {
          const active = s.key === activeKey;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect?.(s.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: active ? "#1a1a1f" : "transparent",
                border: active
                  ? "1px solid #2e2e36"
                  : "1px solid transparent",
                borderRadius: 8,
                padding: "4px 8px",
                margin: "-4px -8px",
                cursor: onSelect ? "pointer" : "default",
                fontFamily: "inherit",
                textAlign: "left",
                width: "calc(100% + 16px)",
                opacity: s.value === 0 ? 0.6 : 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: s.tone === "danger" ? 2 : 999,
                  background: TONE_BAR[s.tone],
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12.5, color: "#c2c2c9", flex: 1 }}>
                {s.label}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#f5f5f6",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.value}
              </span>
            </button>
          );
        })}
      </div>
      )}

      {/* Overlooked promise: alarming above zero, calm at zero.
          Compact renders it as one line under the bar. */}
      {alertCount > 0 ? (
        compact ? (
          <div
            role="alert"
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
            }}
          >
            <OctagonAlert
              size={14}
              strokeWidth={2.5}
              aria-hidden
              style={{ color: "#f87171", flexShrink: 0 }}
            />
            <span>
              <strong style={{ color: "#f87171" }}>
                {alertCount} overlooked.
              </strong>{" "}
              <span style={{ color: "#c2c2c9" }}>
                Found with nobody reaching them and put back on the outreach ladder.
              </span>
            </span>
          </div>
        ) : (
        <div
          role="alert"
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgb(248 113 113 / 14%)",
            border: "1px solid rgb(248 113 113 / 35%)",
            borderRadius: "12px",
            padding: "9px 12px",
          }}
        >
          <OctagonAlert
            size={16}
            strokeWidth={2.5}
            aria-hidden
            style={{ color: "#f87171", flexShrink: 0 }}
          />
          <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            <strong style={{ color: "#f87171" }}>
              {alertCount} overlooked.
            </strong>{" "}
            <span style={{ color: "#c2c2c9" }}>
              Found with nobody reaching them and put back on the outreach ladder.
            </span>
          </span>
        </div>
        )
      ) : compact ? (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#c2c2c9",
          }}
        >
          <CircleCheck
            size={14}
            aria-hidden
            style={{ color: "#3dd68c", flexShrink: 0 }}
          />
          <span>0 overlooked · every home accounted for</span>
        </div>
      ) : (
        <div
          style={{
            marginTop: 10,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 12px",
            border: "1px solid #26262c",
            borderRadius: "12px",
          }}
        >
          <CircleCheck
            size={16}
            aria-hidden
            style={{ color: "#3dd68c", flexShrink: 0 }}
          />
          <span style={{ fontSize: 12.5, color: "#c2c2c9" }}>
            0 overlooked · every home accounted for
          </span>
        </div>
      )}
    </div>
  );
};
