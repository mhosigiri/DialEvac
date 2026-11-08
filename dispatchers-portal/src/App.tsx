import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tables, reducers } from "./module_bindings";
import { useTable, useReducer, useSpacetimeDB } from "spacetimedb/react";
import { Header } from "./components/Header";
import { Sidebar, portalViewFromSearch, type PortalView } from "./components/Sidebar";
import { IncidentMapFrame, type MapCase } from "./components/IncidentMapFrame";
import { EmergencyFeed, type FeedTab } from "./components/EmergencyFeed";
import { QueueFilterBar, QueuePanel } from "./components/QueuePanel";
import { DispatcherUnitsPanel } from "./components/DispatcherUnitsPanel";
import { CaseFile } from "./components/CaseFile";
import { CallInbox } from "./components/CallInbox";
import { Card } from "./design-system/Card";
import { DesignSystemShowcase, Notice } from "./design-system";
import { buildCases } from "./lib/cases";
import { NotAuthorizedBanner } from "./components/OperatorIdentity";
import { failureMessage, isNotAuthorized, type Command } from "./commands";
import { ALL_CASES, CRITICAL_CASES, casesCsv, downloadCsv, isCleared, loadMyCases, matchesQuery, nextCaseToAssign, queueFilters, saveMyCases, type QueueScope } from "./queue";
import type { CaseRow } from "./lib/cases";
import { routeMatchesLocations } from "../../shared/route-guidance";
import { IncidentConsole } from "./incident/IncidentConsole";
import { OutreachConsole } from "./outreach/OutreachConsole";

const CLOCK_TICK_MS = 30_000;

function Portal() {
  const connection = useSpacetimeDB();
  const connected = connection.isActive;
  const everConnected = useRef(false);
  if (connected) everConnected.current = true;
  const identity = connection.identity?.toHexString();

  const [households, householdsReady] = useTable(tables.household);
  const [requests, requestsReady] = useTable(tables.request);
  const [vehicles] = useTable(tables.vehicle);
  const [assignments] = useTable(tables.assignment);
  const [calls] = useTable(tables.call);
  const [transcripts] = useTable(tables.transcriptLine);
  const [messages] = useTable(tables.message);
  const [corrections] = useTable(tables.correction);
  const [handoffs] = useTable(tables.callHandoff);
  const [routes] = useTable(tables.dispatchRoute);
  const [routeGuidances] = useTable(tables.routeGuidance);
  const [zones] = useTable(tables.zone);
  const [coverageRows] = useTable(tables.coverage);
  const [catastropheCases] = useTable(tables.catastropheCase);
  const [callRecords] = useTable(tables.callRecord);
  const [callAnalyses] = useTable(tables.callAnalysis);

  const approveOffer = useReducer(reducers.approveOffer);
  const acceptOffer = useReducer(reducers.acceptOffer);
  const declineOffer = useReducer(reducers.declineOffer);
  const closeRequest = useReducer(reducers.closeRequest);
  const proposePlan = useReducer(reducers.proposePlan);
  const notifyResident = useReducer(reducers.notifyResident);
  const requestDispatchRoute = useReducer(reducers.requestDispatchRoute);
  const retryCallAnalysis = useReducer(reducers.retryCallAnalysis);

  // Held by id so an open case keeps following its live rows, which a call updates as it runs.
  const [openCaseId, setOpenCaseId] = useState<bigint | undefined>();
  const [view, setView] = useState<PortalView>(() => portalViewFromSearch(window.location.search));
  const [feedTab, setFeedTab] = useState<FeedTab>("all");
  const [query, setQuery] = useState("");
  const [busyHouseholdId, setBusyHouseholdId] = useState<bigint | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [notAuthorized, setNotAuthorized] = useState(false);
  const [queueScope, setQueueScope] = useState<QueueScope>("team");
  const [queueFilterId, setQueueFilterId] = useState(ALL_CASES);
  const [myCases, setMyCases] = useState(loadMyCases);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Summaries and urgency count down to the hazard, so they follow the clock as well as the tables.
  const cases = useMemo(
    () => buildCases({ households, requests, vehicles, assignments, calls }),
    [households, requests, vehicles, assignments, calls, now]
  );

  const hazards = useMemo(() => new Map(catastropheCases.map((c) => [c.householdId, c.hazard])), [catastropheCases]);
  const filters = useMemo(() => queueFilters(hazards, now), [hazards, now]);
  // A selected hazard can disappear when the simulation resets.
  const queueFilter = filters.find((f) => f.id === queueFilterId) ?? filters[0];
  const scopedCases = useMemo(
    () => (queueScope === "mine" ? cases.filter((c) => myCases.has(String(c.household.id))) : cases),
    [cases, queueScope, myCases]
  );
  const boardCases = useMemo(() => scopedCases.filter(queueFilter.matches), [scopedCases, queueFilter]);
  const exportCases = useCallback((rows: readonly CaseRow[], name: string) => downloadCsv(name, casesCsv(rows, hazards)), [hazards]);

  const showQueueFilter = (id: string) => {
    setQueueScope("team");
    setQueueFilterId(id);
  };

  // The live NWS feed is display-only, so it must not read as the incident being worked here.
  // A simulation started later takes over the display from one still marked active.
  const incidentZone = zones
    .filter((z) => z.active && z.kind !== "live" && z.source !== "nws")
    .sort((a, b) => Number(b.at.toMillis() - a.at.toMillis()))[0];
  const coverage = coverageRows[0];
  const openCase = cases.find((c) => c.household.id === openCaseId);
  const openRoute = routes.find((r) => r.assignmentId === openCase?.assignment?.id);
  const criticalCount = cases.filter((c) => c.urgency === "critical" && !isCleared(c)).length;

  const send = (command: Command): Promise<void> => {
    switch (command.kind) {
      case "dispatch":
        return proposePlan({
          solver: "dispatcher_portal_manual",
          offers: [
            {
              requestId: command.requestId,
              vehicleId: command.vehicleId,
              shelterId: undefined,
              etaMinutes: command.etaMinutes,
              stopOrder: command.stopOrder,
            },
          ],
          replace: [],
          revoke: [],
        });
      case "approve":
        return approveOffer({ assignmentId: command.assignmentId });
      case "accept":
        return acceptOffer({ assignmentId: command.assignmentId });
      case "decline":
        return declineOffer({ assignmentId: command.assignmentId });
      case "close":
        return closeRequest({ requestId: command.requestId });
      case "notify":
        return notifyResident({ requestId: command.requestId });
      case "route":
        return requestDispatchRoute({ assignmentId: command.assignmentId });
    }
  };

  const handleCommand = async (householdId: bigint, command: Command) => {
    setBusyHouseholdId(householdId);
    setFailure(undefined);
    try {
      await send(command);
      setNotAuthorized(false);
      setMyCases((current) => {
        const next = new Set(current).add(String(householdId));
        saveMyCases(next);
        return next;
      });
    } catch (error) {
      if (isNotAuthorized(error)) setNotAuthorized(true);
      else setFailure(failureMessage(error));
    } finally {
      setBusyHouseholdId(undefined);
    }
  };

  const handleAssignNext = () => {
    const next = nextCaseToAssign(cases);
    if (!next) return;
    if (next.urgency === "critical") setFeedTab("critical");
    showQueueFilter(next.urgency === "critical" ? CRITICAL_CASES : ALL_CASES);
    setOpenCaseId(next.household.id);
  };

  const mapCases = useMemo<MapCase[]>(
    () =>
      cases.map((c) => ({
        id: String(c.household.id),
        lat: c.household.lat,
        lng: c.household.lng,
        label: c.household.name,
        severity: isCleared(c) ? "cleared" : c.urgency,
      })),
    [cases]
  );
  const openCaseFromMap = useCallback((id: string) => { if (/^\d{1,20}$/.test(id)) setOpenCaseId(BigInt(id)); }, []);
  const closeCase = useCallback(() => setOpenCaseId(undefined), []);

  const feedProps = {
    cases,
    loading: cases.length === 0 && (!householdsReady || !requestsReady),
    actionsEnabled: connected,
    busyHouseholdId,
    activeTab: feedTab,
    query,
    selectedHouseholdId: openCaseId,
    onOpenCase: setOpenCaseId,
    onCommand: handleCommand,
  };
  const feed = <EmergencyFeed {...feedProps} />;

  const incidentMap = (
    <IncidentMapFrame
      selected={openCase && { lat: openCase.household.lat, lng: openCase.household.lng, label: openCase.household.name }}
      cases={mapCases}
      route={openRoute?.state === "ready" && openCase?.match?.vehicle && routeMatchesLocations(openRoute, openCase.match.vehicle, openCase.household) ? openRoute.points : undefined}
      responder={openCase?.assignment && openCase.match ? { lat: openCase.match.vehicle.lat, lng: openCase.match.vehicle.lng, label: openCase.match.vehicle.name } : undefined}
      zoneGeometry={incidentZone?.geometryJson}
      onOpenCase={openCaseFromMap}
      onCloseCase={closeCase}
    />
  );

  const fleet = (
    <DispatcherUnitsPanel
      vehicles={vehicles}
      assignments={assignments}
      requests={requests}
      households={households}
    />
  );

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "#060607", color: "#f5f5f6" }}
    >
      <Sidebar view={view} onChange={next => {
        setView(next);
        const url = new URL(window.location.href);
        url.searchParams.delete("demo");
        url.searchParams.set("view", next);
        window.history.replaceState(null, "", url);
      }} connected={connected} />

      {view === "queue" && (
        <QueuePanel
          filters={filters}
          cases={scopedCases}
          scope={queueScope}
          onScopeChange={setQueueScope}
          filterId={queueFilter.id}
          onFilterChange={setQueueFilterId}
          query={query}
          onQueryChange={setQuery}
          onExport={() => exportCases(boardCases.filter((c) => matchesQuery(c, query)), `queue-${queueFilter.label}`)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto">
        {!connected && everConnected.current && (
          <div
            role="alert"
            className="px-6 py-2"
            style={{
              fontSize: 13,
              fontWeight: 600,
              background: "rgb(248 113 113 / 14%)",
              borderBottom: "1px solid rgb(248 113 113 / 35%)",
              color: "#f5f5f6",
            }}
          >
            Connection lost. Everything below may be out of date, and actions are paused until it returns.
          </div>
        )}

        {notAuthorized && <NotAuthorizedBanner identity={identity} onDismiss={() => setNotAuthorized(false)} />}

        {view !== "outreach" && <Header
          identity={identity}
          zone={incidentZone}
          coverage={coverage}
          cases={cases}
          assignments={assignments}
          vehicles={vehicles}
          connected={connected}
          criticalCount={criticalCount}
          query={query}
          onQueryChange={setQuery}
          onShowCritical={() => {
            setView("queue");
            setFeedTab("critical");
            setQuery("");
            showQueueFilter(CRITICAL_CASES);
          }}
          onOpenCase={setOpenCaseId}
          activeTab={feedTab}
          onTabChange={setFeedTab}
          onAssignNext={handleAssignNext}
          onShowFleet={() => setView("fleet")}
          overview={view === "operations"}
          queue={view === "queue"}
        />}

        <main className="flex-1 px-6 pb-8" style={{ minHeight: 0 }}>
          {view === "outreach" && <OutreachConsole />}
          {view === "incident" && <IncidentConsole onError={error => { if (isNotAuthorized(error)) setNotAuthorized(true); else setFailure(failureMessage(error)); }} />}
          {view === "calls" && <CallInbox records={callRecords} analyses={callAnalyses} households={households} onOpenCase={setOpenCaseId} disabled={!connected}
            onRetry={providerId => { void retryCallAnalysis({ providerId }).catch(error => { if (isNotAuthorized(error)) setNotAuthorized(true); else setFailure(failureMessage(error)); }); }} />}
          {view === "operations" && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
              <div className="xl:col-span-4 min-w-0" style={{ minHeight: 560 }}>{feed}</div>
              <div className="xl:col-span-5 min-w-0" style={{ position: "sticky", top: 16 }}>
                <Card label="Live incident map" style={{ height: "calc(100vh - 300px)", minHeight: 420, maxHeight: 760, display: "flex", flexDirection: "column" }}>
                  {incidentMap}
                </Card>
              </div>
              <div className="xl:col-span-3 min-w-0" style={{ minHeight: 560 }}>{fleet}</div>
            </div>
          )}
          {view === "queue" && (
            <>
              <QueueFilterBar
                filters={filters}
                cases={scopedCases}
                scope={queueScope}
                onScopeChange={setQueueScope}
                filterId={queueFilter.id}
                onFilterChange={setQueueFilterId}
              />
              <EmergencyFeed {...feedProps} cases={boardCases} activeTab="all" layout="board" onExportCases={exportCases} />
            </>
          )}
          {view === "fleet" && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
              <div className="xl:col-span-7 min-w-0" style={{ minHeight: 560 }}>{fleet}</div>
              <div className="xl:col-span-5 min-w-0" style={{ position: "sticky", top: 16 }}>
                <Card label="Live incident map" style={{ height: "calc(100vh - 300px)", minHeight: 420, maxHeight: 760, display: "flex", flexDirection: "column" }}>
                  {incidentMap}
                </Card>
              </div>
            </div>
          )}
          {view === "map" && (
            <div className="flex flex-col gap-4">
              <Card label="Live incident map" style={{ height: "62vh", minHeight: 480, display: "flex", flexDirection: "column" }}>
                {incidentMap}
              </Card>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                <div className="min-w-0" style={{ minHeight: 420 }}>{feed}</div>
                <div className="min-w-0 hidden xl:block" style={{ minHeight: 420 }}>{fleet}</div>
              </div>
            </div>
          )}
        </main>
      </div>

      {openCase && (
        <CaseFile
          row={openCase}
          zone={incidentZone}
          vehicles={vehicles}
          calls={calls}
          messages={messages}
          corrections={corrections}
          transcripts={transcripts}
          callRecords={callRecords}
          callAnalyses={callAnalyses}
          handoffs={handoffs}
          route={openRoute}
          guidance={routeGuidances.find(g => g.assignmentId === openCase.assignment?.id)}
          disabled={!connected || busyHouseholdId === openCase.household.id}
          onCommand={handleCommand}
          onClose={closeCase}
        />
      )}

      {failure && <Notice message={failure} onDismiss={() => setFailure(undefined)} />}
    </div>
  );
}

export function App() {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("showcase")) {
    return <DesignSystemShowcase />;
  }
  return <Portal />;
}

export default App;
