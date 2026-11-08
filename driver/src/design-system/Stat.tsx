import React from "react";
import { Badge } from "./Badge";
import type { BadgeTone } from "./Badge";

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  deltaTone?: BadgeTone;
}

/** KPI row from the reference side panel: label and big number on the left, delta pill and note right-aligned. */
export const Stat: React.FC<StatProps> = ({
  label,
  value,
  sub,
  delta,
  deltaTone = "neutral",
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      minWidth: 0,
      flexWrap: "wrap",
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 12.5,
          color: "#c2c2c9",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 400,
          letterSpacing: "-0.025em",
          color: "#f5f5f6",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.05,
          marginTop: 4,
          fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        {value}
      </div>
    </div>
    {(delta || sub) && (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          paddingTop: 2,
          textAlign: "right",
          flexShrink: 1,
          minWidth: 0,
          maxWidth: "65%",
        }}
      >
        {delta && <Badge tone={deltaTone}>{delta}</Badge>}
        {sub && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ds-text-muted)",
              lineHeight: 1.45,
            }}
          >
            {sub}
          </div>
        )}
      </div>
    )}
  </div>
);
