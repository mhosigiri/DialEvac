import React from "react";

export const millis = (t: { toMillis(): bigint }) => Number(t.toMillis());
export const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section
    style={{
      margin: 0,
      background: "transparent",
      border: "none",
      borderTop: "1px solid var(--ds-border)",
      padding: "16px 20px",
    }}
  >
    <h3
      style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ds-text)", margin: "0 0 10px" }}
    >
      {title}
    </h3>
    {children}
  </section>
);

export const Facts: React.FC<{ rows: [string, React.ReactNode][] }> = ({ rows }) => (
  <dl style={{ display: "grid", gridTemplateColumns: "minmax(108px, 0.8fr) minmax(0, 1.2fr)", gap: "6px 16px", margin: 0, fontSize: 12.5, lineHeight: 1.45 }}>
    {rows.map(([label, value]) => (
      <React.Fragment key={label}>
        <dt style={{ color: "var(--ds-text-muted)" }}>{label}</dt>
        <dd style={{ margin: 0, color: "var(--ds-text)", minWidth: 0, overflowWrap: "anywhere" }}>{value}</dd>
      </React.Fragment>
    ))}
  </dl>
);

export const Quiet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--ds-text-muted)" }}>{children}</p>
);
