import React from "react";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  variant?: "underline" | "segmented";
}

/** Underline (page nav) or segmented (filter) tabs, per reference. */
export const Tabs: React.FC<TabsProps> = ({
  items,
  activeId,
  onChange,
  variant = "underline",
}) => {
  if (variant === "segmented") {
    return (
      <div
        role="tablist"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: 4,
          background: "#1a1a1f",
          border: "1px solid #26262c",
          borderRadius: "12px",
        }}
      >
        {items.map((t) => {
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.id)}
              style={{
                flex: 1,
                minHeight: 32,
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: active ? 600 : 500,
                fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                background: active
                  ? "#232329"
                  : "transparent",
                color: active
                  ? "#f5f5f6"
                  : "#9a9aa0",
                border: active
                  ? "1px solid #26262c"
                  : "1px solid transparent",
                cursor: "pointer",
                padding: "6px 12px",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
              {typeof t.count === "number" ? ` ${t.count}` : ""}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid #26262c",
        overflowX: "auto",
        overflowY: "hidden",
        maxWidth: "100%",
      }}
    >
      {items.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "10px 2px 12px",
              marginRight: 20,
              flexShrink: 0,
              whiteSpace: "nowrap",
              fontSize: 13.5,
              fontWeight: active ? 600 : 500,
              fontFamily: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
              color: active
                ? "#f5f5f6"
                : "#9a9aa0",
              borderBottom: active
                ? "2px solid #f5f5f6"
                : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span style={{ opacity: 0.55, marginLeft: 4, fontVariantNumeric: "tabular-nums" }}> {t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};
