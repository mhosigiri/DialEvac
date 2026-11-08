import React from "react";

export interface Column {
  key: string;
  header: string;
  strong?: boolean;
  width?: number;
}

interface DataTableProps {
  columns: Column[];
  rows: Record<string, React.ReactNode>[];
  label?: string;
  minWidth?: number;
}

/** Reference table section (payment timeline / audit trail). */
export const DataTable: React.FC<DataTableProps> = ({
  columns,
  rows,
  label,
  minWidth = 480,
}) => {
  // One template for every row: separate row grids only line up if no column sizes to its content.
  const template = columns.map((c) => (c.width ? `${c.width}px` : "minmax(0, 1fr)")).join(" ");
  return (
  <div style={{ overflowX: "auto" }} role="table" aria-label={label}>
    <div style={{ minWidth }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: template,
          gap: 8,
          padding: "6px 0 10px",
          borderBottom: "1px solid #26262c",
          fontSize: 12,
          fontWeight: 400,
          color: "#9a9aa0",
          letterSpacing: "0",
        }}
      >
        {columns.map((c) => (
          <div key={c.key}>{c.header}</div>
        ))}
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: template,
            padding: "11px 0",
            borderBottom:
              i === rows.length - 1
                ? "none"
                : "1px solid #26262c",
            fontSize: 13,
            alignItems: "center",
            gap: 8,
          }}
        >
          {columns.map((c) => (
            <div
              key={c.key}
              style={{
                color: c.strong
                  ? "#f5f5f6"
                  : "#c2c2c9",
                fontWeight: c.strong ? 500 : 400,
                fontVariantNumeric: "tabular-nums",
                overflow: "hidden",
                minWidth: 0,
                lineHeight: 1.45,
              }}
            >
              {row[c.key]}
            </div>
          ))}
        </div>
      ))}
    </div>
  </div>
  );
};
