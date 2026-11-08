import React, { useEffect, useMemo, useState } from "react";
import { tables, reducers } from "./module_bindings";
import { useTable, useReducer, useSpacetimeDB } from "spacetimedb/react";
import { DriverHeader } from "./components/DriverHeader";
import { LiveOfferModal } from "./components/LiveOfferModal";
import { RunList } from "./components/RunList";
import { TurnByTurnNav } from "./components/TurnByTurnNav";
import { DriverComms } from "./components/DriverComms";
import { DriverBottomNav, type DriverTab } from "./components/DriverBottomNav";
import { buildDriverStops, type DriverStop } from "./lib/driver-state";
import { Notice } from "./design-system/Notice";
import { EmptyState } from "./design-system/EmptyState";

const LOCAL_STORAGE_VEHICLE_KEY = "dialevac_driver_vehicle_id";

export default function App() {
  const connection = useSpacetimeDB();
  const connected = connection.isActive;

  // SpacetimeDB table subscriptions
  const [vehicles] = useTable(tables.vehicle);
  const [assignments] = useTable(tables.assignment);
  const [requests] = useTable(tables.request);
  const [households] = useTable(tables.household);
  const [shelters] = useTable(tables.shelter);
  const [routes] = useTable(tables.dispatchRoute);
  const [routeGuidances] = useTable(tables.routeGuidance);
  const [roadClosures] = useTable(tables.roadClosure);
  const [messages] = useTable(tables.message);

  // Reducers
  const acceptOffer = useReducer(reducers.acceptOffer);
  const declineOffer = useReducer(reducers.declineOffer);
  const cancelByDriver = useReducer(reducers.cancelByDriver);
  const requestDispatchRoute = useReducer(reducers.requestDispatchRoute);

  // State
  const [selectedVehicleId, setSelectedVehicleId] = useState<bigint | undefined>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_VEHICLE_KEY);
    return saved ? BigInt(saved) : undefined;
  });

  const [activeTab, setActiveTab] = useState<DriverTab>("manifest");
  const [selectedStopId, setSelectedStopId] = useState<bigint | undefined>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [dismissedOffers, setDismissedOffers] = useState<Set<string>>(new Set());
  const [isCommsOpen, setIsCommsOpen] = useState(false);
  const [localCommsMessages, setLocalCommsMessages] = useState<{ id: bigint; householdId: bigint; direction: string; body: string; at: { toMillis: () => number } }[]>([]);

  // Auto-select vehicle if none chosen or invalid
  useEffect(() => {
    if (vehicles.length > 0) {
      if (!selectedVehicleId || !vehicles.some((v) => v.id === selectedVehicleId)) {
        const defaultVehicle = vehicles[0];
        setSelectedVehicleId(defaultVehicle.id);
        localStorage.setItem(LOCAL_STORAGE_VEHICLE_KEY, defaultVehicle.id.toString());
      }
    }
  }, [vehicles, selectedVehicleId]);

  const handleSelectVehicle = (id: bigint) => {
    setSelectedVehicleId(id);
    localStorage.setItem(LOCAL_STORAGE_VEHICLE_KEY, id.toString());
    setSelectedStopId(undefined);
  };

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  // Filter pending offers for this vehicle
  const pendingOffers = useMemo(() => {
    if (!selectedVehicleId) return [];
    return assignments.filter(
      (a) =>
        a.vehicleId === selectedVehicleId &&
        a.status === "offered" &&
        !dismissedOffers.has(a.id.toString())
    );
  }, [assignments, selectedVehicleId, dismissedOffers]);

  // Active accepted stops for this vehicle
  const stops = useMemo(() => {
    return buildDriverStops(assignments, requests, households, shelters, selectedVehicleId);
  }, [assignments, requests, households, shelters, selectedVehicleId]);

  // Determine active stop for navigation
  const activeStop = useMemo(() => {
    if (selectedStopId) {
      const found = stops.find((s) => s.assignmentId === selectedStopId);
      if (found) return found;
    }
    return stops[0];
  }, [stops, selectedStopId]);

  // Route and guidance for active stop
  const activeRoute = useMemo(() => {
    if (!activeStop) return undefined;
    return routes.find((r) => r.assignmentId === activeStop.assignmentId);
  }, [routes, activeStop]);

  const activeGuidance = useMemo(() => {
    if (!activeStop || !activeRoute) return undefined;
    return routeGuidances.find(
      (g) => g.assignmentId === activeStop.assignmentId && g.revision === activeRoute.revision
    );
  }, [routeGuidances, activeStop, activeRoute]);

  // Automatically request route when stop is selected and no route exists
  const handleRequestRoute = async (assignmentId: bigint) => {
    try {
      setBusy(true);
      setActionError(undefined);
      await requestDispatchRoute({ assignmentId });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Accept incoming dispatch offer
  const handleAcceptOffer = async (assignmentId: bigint) => {
    try {
      setBusy(true);
      setActionError(undefined);
      await acceptOffer({ assignmentId });
      // Queue a route right away
      try {
        await requestDispatchRoute({ assignmentId });
      } catch {
        /* Route queueing optional on accept */
      }
      setSelectedStopId(assignmentId);
      setActiveTab("navigation");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Decline incoming dispatch offer
  const handleDeclineOffer = async (assignmentId: bigint) => {
    try {
      setBusy(true);
      setActionError(undefined);
      await declineOffer({ assignmentId });
      setDismissedOffers((prev) => new Set([...prev, assignmentId.toString()]));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Driver cancellation of an accepted stop
  const handleCancelStop = async (assignmentId: bigint, reason: string) => {
    try {
      setBusy(true);
      setActionError(undefined);
      await cancelByDriver({ assignmentId, reason });
      if (selectedStopId === assignmentId) {
        setSelectedStopId(undefined);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Select a stop to navigate to
  const handleSelectStop = (stop: DriverStop) => {
    setSelectedStopId(stop.assignmentId);
    setActiveTab("navigation");
    if (!routes.some((r) => r.assignmentId === stop.assignmentId)) {
      handleRequestRoute(stop.assignmentId);
    }
  };

  // First incoming offer for the modal
  const currentOffer = pendingOffers[0];
  const currentOfferRequest = currentOffer ? requests.find((r) => r.id === currentOffer.requestId) : undefined;
  const currentOfferHousehold = currentOfferRequest
    ? households.find((h) => h.id === currentOfferRequest.householdId)
    : undefined;

  return (
    <div className="min-h-screen bg-[#060607] text-[#f5f5f6] flex flex-col font-sans">
      {/* Driver Header */}
      <DriverHeader
        vehicles={vehicles}
        selectedVehicleId={selectedVehicleId}
        onSelectVehicle={handleSelectVehicle}
        connected={connected}
        offersCount={pendingOffers.length}
        onOpenComms={() => setIsCommsOpen(true)}
      />

      {/* Global Action Error Banner */}
      {actionError && (
        <Notice
          message={actionError}
          onDismiss={() => setActionError(undefined)}
        />
      )}

      {/* Main View Body */}
      <main className="flex-1 overflow-y-auto no-scrollbar">
        {/* Tab 1: Live Offers */}
        {activeTab === "offers" && (
          <div className="p-4 max-w-lg mx-auto space-y-4 pb-24">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#f5f5f6]">Incoming Dispatch Offers</h2>
                <p className="text-xs text-[#a3a3aa]">
                  Real-time evacuation cases matched to your vehicle unit
                </p>
              </div>
              {pendingOffers.length > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#e8b84b] text-black">
                  {pendingOffers.length} Pending
                </span>
              )}
            </div>

            {pendingOffers.length === 0 ? (
              <div className="py-12">
                <EmptyState
                  title="No Pending Offers"
                  detail="All matched offers for this vehicle have been accepted or settled. Stand by on radio for new dispatch dispatches."
                />
              </div>
            ) : (
              <div className="space-y-3">
                {pendingOffers.map((offer) => {
                  const req = requests.find((r) => r.id === offer.requestId);
                  const home = req ? households.find((h) => h.id === req.householdId) : undefined;
                  const people = req?.people || 1;

                  return (
                    <div
                      key={offer.id.toString()}
                      className="bg-[#131316] border-2 border-[#e8b84b] rounded-2xl p-4 shadow-lg space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-base font-bold text-[#f5f5f6]">
                            {home ? home.name : "Evacuation Request"}
                          </div>
                          <div className="text-xs text-[#c2c2c9] mt-0.5 flex items-center gap-1">
                            <span>📍</span>
                            <span>{home ? home.address : "Map Coordinates"}</span>
                          </div>
                        </div>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#e8b84b]/20 text-[#e8b84b] border border-[#e8b84b]/40">
                          {offer.etaMinutes ? `~${offer.etaMinutes}m ETA` : "Offered"}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-[#a3a3aa]">
                        <span>Headcount: <b className="text-white">{people}</b></span>
                        <span>Mobility: <b className="text-white capitalize">{req?.mobility || home?.mobility || "walks"}</b></span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleAcceptOffer(offer.id)}
                          className="py-2.5 rounded-xl bg-[#3dd68c] hover:bg-[#34b879] text-[#060607] font-bold text-xs flex items-center justify-center gap-1.5 shadow"
                        >
                          Accept Run ✓
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDeclineOffer(offer.id)}
                          className="py-2.5 rounded-xl bg-[#1a1a1f] hover:bg-[#26262c] text-[#f87171] border border-[#f87171]/30 font-semibold text-xs flex items-center justify-center"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Run List (Manifest) */}
        {activeTab === "manifest" && (
          <RunList
            stops={stops}
            onSelectStop={handleSelectStop}
            selectedStopId={selectedStopId}
            onCancelStop={handleCancelStop}
            busy={busy}
          />
        )}

        {/* Tab 3: Turn-by-Turn Map & Navigation */}
        {activeTab === "navigation" && (
          <>
            {activeStop ? (
              <TurnByTurnNav
                stop={activeStop}
                vehicle={selectedVehicle}
                route={activeRoute}
                guidance={activeGuidance}
                roadClosures={roadClosures}
                onRequestRoute={handleRequestRoute}
                onOpenComms={() => setIsCommsOpen(true)}
                busy={busy}
              />
            ) : (
              <div className="py-16 px-4 max-w-md mx-auto space-y-4 text-center">
                <EmptyState
                  title="No Stop Selected"
                  detail="Accept an offer or choose a stop from your Run List to view turn-by-turn road route guidance and map navigation."
                />
                {stops.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("manifest")}
                    className="px-4 py-2.5 rounded-xl bg-[#8fb0ff] text-black font-bold text-xs shadow-md"
                  >
                    View Manifest Stops ({stops.length})
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* High-priority Live Offer Modal (Shows over any view when new dispatch arrives) */}
      {currentOffer && activeTab !== "offers" && (
        <LiveOfferModal
          assignment={currentOffer}
          request={currentOfferRequest}
          household={currentOfferHousehold}
          onAccept={handleAcceptOffer}
          onDecline={handleDeclineOffer}
          busy={busy}
        />
      )}

      {/* Driver Tactical Radio & Comms Sheet */}
      <DriverComms
        householdId={activeStop?.householdId}
        messages={messages}
        isOpen={isCommsOpen}
        onClose={() => setIsCommsOpen(false)}
        onSendMessage={(text) => {
          // Track locally and in connection
          if (activeStop) {
            setLocalCommsMessages((prev) => [
              ...prev,
              {
                id: BigInt(Date.now()),
                householdId: activeStop.householdId,
                direction: "in",
                body: text,
                at: { toMillis: () => Date.now() },
              },
            ]);
          }
        }}
      />

      {/* Mobile Bottom Navigation */}
      <DriverBottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        pendingOffersCount={pendingOffers.length}
        activeStopsCount={stops.length}
      />
    </div>
  );
}
