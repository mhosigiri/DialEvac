import React, { useState } from "react";
import { tables, reducers } from "./module_bindings";
import { useTable, useReducer, useSpacetimeDB } from "spacetimedb/react";
import { Header } from "./components/Header";
import { EmergencyMap } from "./components/EmergencyMap";
import { EmergencyFeed } from "./components/EmergencyFeed";
import { DispatcherUnitsPanel } from "./components/DispatcherUnitsPanel";
import { TranscriptDrawer } from "./components/TranscriptDrawer";
import type { Household, Call, Request, Vehicle } from "./module_bindings/types";

export function App() {
  const connectionState = useSpacetimeDB();
  const connected = connectionState.isActive;

  // SpacetimeDB Real-time Tables
  const [households] = useTable(tables.household);
  const [requests] = useTable(tables.request);
  const [vehicles] = useTable(tables.vehicle);
  const [assignments] = useTable(tables.assignment);
  const [calls] = useTable(tables.call);
  const [transcripts] = useTable(tables.transcriptLine);
  const [zones] = useTable(tables.zone);
  const [coverageRows] = useTable(tables.coverage);

  // Reducer Hooks
  const approveOffer = useReducer(reducers.approveOffer);
  const acceptOffer = useReducer(reducers.acceptOffer);
  const declineOffer = useReducer(reducers.declineOffer);
  const closeRequest = useReducer(reducers.closeRequest);
  const proposePlan = useReducer(reducers.proposePlan);

  // UI Selection State
  const [selectedHousehold, setSelectedHousehold] = useState<Household | undefined>();
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | undefined>();
  const [transcriptTarget, setTranscriptTarget] = useState<{
    household?: Household;
    call?: Call;
    request?: Request;
  } | null>(null);

  // Active Zone (first active or first in table)
  const activeZone = zones.find((z) => z.active) || zones[0];
  const coverage = coverageRows[0];

  // Computed metrics
  const activeRescues = assignments.filter(
    (a) => a.status === "accepted" || a.status === "offered"
  ).length;

  const criticalCount = households.filter((h) => {
    const req = requests.find((r) => r.householdId === h.id);
    return (req?.oxygen ?? h.oxygen) || (req?.mobility ?? h.mobility) === "bedbound";
  }).length;

  // Handlers
  const handleOpenTranscript = (household: Household, call?: Call, request?: Request) => {
    setTranscriptTarget({ household, call, request });
  };

  const handleCloseTranscript = () => {
    setTranscriptTarget(null);
  };

  const handleDispatchClosest = async (requestId: bigint, vehicleId: bigint) => {
    try {
      // Check if an existing proposed assignment already exists
      const existing = assignments.find(
        (a) => a.requestId === requestId && a.status === "proposed"
      );
      if (existing) {
        await approveOffer({ assignmentId: existing.id });
      } else {
        await proposePlan({
          solver: "dispatcher_portal_manual",
          offers: [
            {
              requestId,
              vehicleId,
              shelterId: undefined,
              etaMinutes: 5,
              stopOrder: 1,
            },
          ],
          replace: [],
          revoke: [],
        });
      }
    } catch (err) {
      console.error("Failed to dispatch vehicle:", err);
    }
  };

  const handleAcceptOffer = async (assignmentId: bigint) => {
    try {
      await acceptOffer({ assignmentId });
    } catch (err) {
      console.error("Failed to accept mission:", err);
    }
  };

  const handleDeclineOffer = async (assignmentId: bigint) => {
    try {
      await declineOffer({ assignmentId });
    } catch (err) {
      console.error("Failed to decline mission:", err);
    }
  };

  const handleCloseRequest = async (requestId: bigint) => {
    try {
      await closeRequest({ requestId });
    } catch (err) {
      console.error("Failed to close request:", err);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Operations Header */}
      <Header
        zone={activeZone}
        coverage={coverage}
        connected={connected}
        activeRescuesCount={activeRescues}
        criticalCount={criticalCount}
      />

      {/* Main EOC Operations Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 overflow-hidden">
        {/* Left: Live Triage & Incident Feed (5 cols) */}
        <div className="lg:col-span-5 h-full overflow-hidden flex flex-col">
          <EmergencyFeed
            households={households}
            requests={requests}
            vehicles={vehicles}
            assignments={assignments}
            calls={calls}
            onOpenTranscript={handleOpenTranscript}
            onDispatchClosest={handleDispatchClosest}
            onAcceptOffer={handleAcceptOffer}
            onDeclineOffer={handleDeclineOffer}
            onCloseRequest={handleCloseRequest}
            onSelectVictim={(h) => setSelectedHousehold(h)}
          />
        </div>

        {/* Center / Right: Interactive Map & Fleet Operations (7 cols) */}
        <div className="lg:col-span-7 h-full flex flex-col gap-4 overflow-hidden">
          {/* Top: Incident Map & Graph Vectors */}
          <div className="flex-1 min-h-[350px]">
            <EmergencyMap
              zone={activeZone}
              households={households}
              vehicles={vehicles}
              requests={requests}
              assignments={assignments}
              selectedHousehold={selectedHousehold}
              selectedVehicleId={selectedVehicle?.id}
              onSelectHousehold={(h) => setSelectedHousehold(h)}
            />
          </div>

          {/* Bottom: Rescue Fleet & Unit Status */}
          <div className="h-[220px] shrink-0">
            <DispatcherUnitsPanel
              vehicles={vehicles}
              assignments={assignments}
              requests={requests}
              households={households}
              selectedVehicleId={selectedVehicle?.id}
              onSelectVehicle={(v) => setSelectedVehicle(v)}
            />
          </div>
        </div>
      </div>

      {/* Transcript Viewer Modal */}
      {transcriptTarget && (
        <TranscriptDrawer
          household={transcriptTarget.household}
          call={transcriptTarget.call}
          request={transcriptTarget.request}
          transcripts={transcripts}
          onClose={handleCloseTranscript}
        />
      )}
    </div>
  );
}

export default App;
