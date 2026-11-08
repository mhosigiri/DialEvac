import React from "react";

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  label?: string;
}

/** Reference card: dark surface, subtle border, restrained elevation. */
export const Card: React.FC<CardProps> = ({ children, style, label }) => {
  // App owns layout. Bound only its sticky map variant here; the full map view keeps its own height.
  const stickyMap = label === "Live incident map" && style?.height === "calc(100vh - 300px)";
  const resolvedStyle = stickyMap
    ? { ...style, height: "clamp(360px, calc(100vh - 520px), 640px)", minHeight: 360, maxHeight: 640 }
    : style;
  return (
    <section
      aria-label={label}
      style={{
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-radius-panel)",
        boxShadow: "0 1px 2px rgb(0 0 0 / 20%)",
        padding: "20px",
        ...resolvedStyle,
      }}
    >
      {children}
    </section>
  );
};

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  action,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: subtitle ? 6 : 14,
    }}
  >
    <div style={{ minWidth: 0 }}>
      <h3
        style={{
          color: "#f5f5f6",
          fontSize: 16,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          margin: 0,
          fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        {title}
      </h3>
      {subtitle && (
        <p
          style={{
            color: "var(--ds-text-muted)",
            fontSize: 12.5,
            lineHeight: 1.45,
            margin: "3px 0 0",
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
    {action}
  </div>
);

export const CardDivider: React.FC = () => (
  <hr
    style={{
      border: "none",
      borderTop: "1px solid #26262c",
      margin: "14px 0",
    }}
  />
);
