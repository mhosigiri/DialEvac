import React, { useMemo } from "react";
import { Ambulance, Car } from "lucide-react";
import type { Vehicle, Assignment, Request, Household } from "../module_bindings/types";
import { Badge } from "../design-system/Badge";
import { Card, CardDivider, CardHeader } from "../design-system/Card";
import { DataTable } from "../design-system/DataTable";
import { EmptyState } from "../design-system/EmptyState";

interface DispatcherUnitsPanelProps {
  vehicles: readonly Vehicle[];
  assignments: readonly Assignment[];
  requests: readonly Request[];
  households: readonly Household[];
}

function statusOf(vehicleId: bigint, assignments: readonly Assignment[]) {
  const a = assignments.find(
    (x) => x.vehicleId === vehicleId && (x.status === "accepted" || x.status === "offered")
  );
  return a;
}

export const DispatcherUnitsPanel: React.FC<DispatcherUnitsPanelProps> = ({
  vehicles,
  assignments,
  requests,
  households,
}) => {
  const rows = useMemo(
    () =>
      vehicles.map((v) => {
        const active = statusOf(v.id, assignments);
        const req = active ? requests.find((r) => r.id === active.requestId) : undefined;
        const home = req ? households.find((h) => h.id === req.householdId) : undefined;
        const status = active?.status === "accepted" ? "En route" : active?.status === "offered" ? "Offered" : "Available";
        const tone = active?.status === "accepted" ? "warning" : active?.status === "offered" ? "info" : ("success" as const);
        return {
          Unit: (
            <span className="flex items-center gap-1.5" style={{ fontWeight: 500, minWidth: 0 }}>
              {v.kind === "ambulance" ? (
                <Ambulance className="w-3.5 h-3.5 shrink-0" style={{ color: "#9a9aa0" }} />
              ) : (
                <Car className="w-3.5 h-3.5 shrink-0" style={{ color: "#9a9aa0" }} />
              )}
              <span style={{ minWidth: 0, lineHeight: 1.35 }}>
                {v.name}
                {v.lift ? " · Lift" : ""}
              </span>
            </span>
          ),
          Status: <Badge tone={tone} dot={active?.status === "offered"}>{status}</Badge>,
          Assignment: home ? home.address : "—",
          ETA: active?.etaMinutes != null ? `${active.etaMinutes}m` : "—",
        };
      }),
    [vehicles, assignments, requests, households]
  );

  const enRoute = assignments.filter((a) => a.status === "accepted").length;
  const offered = assignments.filter((a) => a.status === "offered").length;

  return (
    <Card label="Rescue fleet" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <CardHeader
        title="Rescue fleet"
        subtitle={`${vehicles.length} units · ${enRoute} en route · ${offered} offered`}
        action={<Badge tone="neutral">{vehicles.length} {vehicles.length === 1 ? "unit" : "units"}</Badge>}
      />
      {vehicles.length === 0 ? (
        <EmptyState title="No rescue units loaded" detail="No active rescue units loaded in SpacetimeDB." />
      ) : (
        <div style={{ overflowY: "auto", minHeight: 0 }}>
          <DataTable
            label="Rescue fleet"
            minWidth={0}
            columns={[
              { key: "Unit", header: "Unit", strong: true },
              { key: "Status", header: "Status", width: 92 },
              { key: "ETA", header: "ETA", width: 36 },
            ]}
            rows={rows}
          />
          <CardDivider />
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              background: "#1a1a1f",
              border: "1px solid #26262c",
              borderRadius: "12px",
              padding: "9px 12px",
              fontSize: 12,
              lineHeight: 1.5,
              color: "#c2c2c9",
            }}
          >
            <span style={{ fontWeight: 700, color: "#f5f5f6", whiteSpace: "nowrap" }}>
              {enRoute + offered} tasked
            </span>
            <span>
              {enRoute} en route · {offered} awaiting driver answer · {Math.max(0, vehicles.length - enRoute - offered)} staged.
            </span>
          </div>
        </div>
      )}
    </Card>
  );
};
