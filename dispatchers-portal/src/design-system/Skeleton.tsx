import React from "react";

interface SkeletonProps {
  lines?: number;
  height?: number;
}

/**
 * Loading placeholder for a queue or panel. Shimmer is disabled under
 * prefers-reduced-motion (see .ds-skeleton-line in index.css).
 */
export const Skeleton: React.FC<SkeletonProps> = ({ lines = 3, height = 12 }) => (
  <div
    role="status"
    aria-label="Loading"
    style={{ display: "flex", flexDirection: "column", gap: 10 }}
  >
    {Array.from({ length: Math.max(1, lines) }).map((_, i) => (
      <span
        key={i}
        className="ds-skeleton-line"
        aria-hidden
        style={{
          display: "block",
          height,
          borderRadius: 6,
          width: i === Math.max(1, lines) - 1 ? "62%" : "100%",
          background: "#2e2e36",
        }}
      />
    ))}
  </div>
);
