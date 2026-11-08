import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Bell, CircleAlert, X } from "lucide-react";
import type { CaseRow } from "../lib/cases";
import { isCleared } from "../queue";
import { Badge } from "../design-system/Badge";
import { Button } from "../design-system/Button";

interface NotificationsProps {
  cases: readonly CaseRow[];
  criticalCount: number;
  onOpenCase: (householdId: bigint) => void;
  onShowCritical: () => void;
}

export function criticalNotifications(cases: readonly CaseRow[]) {
  return cases.filter((row) => row.urgency === "critical" && !isCleared(row));
}

/** Critical-case alerts with direct case and queue actions. */
export const Notifications: React.FC<NotificationsProps> = ({
  cases,
  criticalCount,
  onOpenCase,
  onShowCritical,
}) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const headingId = useId();
  const alerts = useMemo(() => criticalNotifications(cases), [cases]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const label = `Notifications${criticalCount > 0 ? ` (${criticalCount} critical)` : ""}`;

  return (
    <div ref={root} className="eoc-notifications">
      <button
        ref={trigger}
        type="button"
        title="Notifications"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        style={{
          position: "relative",
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: "12px",
          background: open ? "#232329" : "#1a1a1f",
          border: "1px solid #26262c",
          color: "#c2c2c9",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Bell className="w-4 h-4" />
        {criticalCount > 0 && (
          <span aria-hidden style={{ position: "absolute", top: 8, right: 9, width: 8, height: 8, borderRadius: 999, background: "#f87171" }} />
        )}
      </button>

      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          className="eoc-notifications-panel"
        >
          <header
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              padding: 16,
              borderBottom: "1px solid var(--ds-border)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 id={headingId} style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--ds-text)" }}>
                  Notifications
                </h2>
                <Badge tone={alerts.length > 0 ? "danger" : "neutral"}>
                  {alerts.length} critical
                </Badge>
              </div>
              <p style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.45, color: "var(--ds-text-muted)" }}>
                Open cases that need immediate attention.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close notifications"
              onClick={() => setOpen(false)}
              style={{
                flexShrink: 0,
                width: 32,
                height: 32,
                display: "grid",
                placeItems: "center",
                borderRadius: 10,
                border: "1px solid var(--ds-border)",
                background: "var(--ds-surface-raised)",
                color: "var(--ds-text-secondary)",
                cursor: "pointer",
              }}
            >
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="eoc-notification-list">
            {alerts.length === 0 ? (
              <div style={{ padding: "28px 12px", textAlign: "center", color: "var(--ds-text-muted)" }}>
                <CircleAlert className="w-5 h-5" style={{ margin: "0 auto 10px" }} />
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ds-text-secondary)" }}>No critical notifications</div>
                <p style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.45 }}>New critical cases will appear here.</p>
              </div>
            ) : (
              alerts.map((row) => (
                <button
                  key={String(row.household.id)}
                  type="button"
                  className="eoc-notification-item"
                  aria-label={`Open critical case: ${row.household.name}`}
                  onClick={() => {
                    setOpen(false);
                    onOpenCase(row.household.id);
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, color: "var(--ds-text)", overflowWrap: "anywhere" }}>
                      {row.household.name}
                    </strong>
                    <Badge tone="danger">Critical</Badge>
                  </span>
                  <span style={{ fontSize: 12, lineHeight: 1.4, color: "var(--ds-text-muted)", overflowWrap: "anywhere" }}>
                    {row.household.address}
                  </span>
                  <span style={{ fontSize: 12, lineHeight: 1.45, color: "var(--ds-text-secondary)", overflowWrap: "anywhere" }}>
                    {row.summary}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-accent)" }}>Open case →</span>
                </button>
              ))
            )}
          </div>

          <footer style={{ padding: 12, borderTop: "1px solid var(--ds-border)" }}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              fullWidth
              onClick={() => {
                setOpen(false);
                onShowCritical();
              }}
            >
              View critical queue
            </Button>
          </footer>
        </section>
      )}
    </div>
  );
};
