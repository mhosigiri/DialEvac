import React from "react";

interface PageHeaderProps {
  title: string;
  status?: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
}

/** Reference page header: title + status pill + description + actions. */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  status,
  description,
  actions,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap",
    }}
  >
    <div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        <h1
          style={{
            fontSize: 34,
            fontWeight: 400,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            color: "#f5f5f6",
            margin: 0,
            fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          }}
        >
          {title}
        </h1>
        {status}
      </div>
      {description && (
        <p
          style={{
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "#c2c2c9",
            margin: "6px 0 0",
            maxWidth: 640,
          }}
        >
          {description}
        </p>
      )}
    </div>
    {actions && (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>
    )}
  </div>
);
