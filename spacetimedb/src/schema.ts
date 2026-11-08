import { schema, t, table } from "spacetimedb/server";

// The contract every part of the app reads and writes. Statuses are strings checked against the
// unions in domain/; reducers are the only writers, so a row never holds a value outside them.

const control = table(
  { name: "control", public: true },
  {
    id: t.u32().primaryKey(),
    hazard: t.string(),
    warningAt: t.option(t.timestamp()),
    generation: t.u64(),
    simulateVoice: t.bool(),
    simulateDispatch: t.bool(),
    simulateDrivers: t.bool(),
    autoApprove: t.bool(),
    originLat: t.f64(),
    originLng: t.f64(),
    firstArrivalMinutes: t.f64(),
    metersPerMinute: t.f64(),
  },
);

const household = table(
  { name: "household", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    riderId: t.string().unique(),
    name: t.string(),
    address: t.string(),
    lat: t.f64(),
    lng: t.f64(),
    phone: t.string().index("btree"),
    language: t.string(),
    simulated: t.bool(),
    inZone: t.bool().index("btree"),
    reach: t.string(),
    canLeave: t.option(t.bool()),
    people: t.u32(),
    mobility: t.string(),
    assistance: t.string(),
    oxygen: t.bool(),
    hazardAt: t.option(t.timestamp()),
    needProbability: t.f64(),
  },
);

const correction = table(
  { name: "correction", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index("btree"),
    field: t.string(),
    before: t.string(),
    after: t.string(),
    source: t.string(),
    at: t.timestamp(),
  },
);

const call = table(
  { name: "call", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index("btree"),
    purpose: t.string(),
    phase: t.string().index("btree"),
    attempt: t.u32(),
    // urgency() when queued; the voice service places the highest first.
    priority: t.f64(),
    outcome: t.option(t.string()),
    providerId: t.option(t.string()),
    queuedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
  },
);

const transcriptLine = table(
  { name: "transcript_line", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.u64().index("btree"),
    speaker: t.string(),
    text: t.string(),
    requestStatus: t.option(t.string()),
    at: t.timestamp(),
  },
);

const message = table(
  { name: "message", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().index("btree"),
    direction: t.string(),
    state: t.string().index("btree"),
    body: t.string(),
    requestStatus: t.option(t.string()),
    providerId: t.option(t.string()),
    error: t.option(t.string()),
    at: t.timestamp(),
  },
);

const request = table(
  { name: "request", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    householdId: t.u64().unique(),
    status: t.string().index("btree"),
    people: t.u32(),
    mobility: t.string(),
    assistance: t.string(),
    oxygen: t.bool(),
    deadlineAt: t.timestamp(),
    escalation: t.option(t.string()),
    etaMinutes: t.option(t.u32()),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  },
);

const vehicle = table(
  { name: "vehicle", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    driverName: t.string(),
    kind: t.string(),
    seats: t.u32(),
    wheelchairSpaces: t.u32(),
    stretcherSpaces: t.u32(),
    crew: t.u32(),
    lift: t.bool(),
    lat: t.f64(),
    lng: t.f64(),
    simulated: t.bool(),
  },
);

const shelter = table(
  { name: "shelter", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    lat: t.f64(),
    lng: t.f64(),
    capacity: t.u32(),
  },
);

const plan = table(
  { name: "plan", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    solver: t.string(),
    solveMs: t.u32(),
    requestCount: t.u32(),
    vehicleCount: t.u32(),
    fallbackReason: t.option(t.string()),
    at: t.timestamp(),
  },
);

const assignment = table(
  { name: "assignment", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    requestId: t.u64().index("btree"),
    vehicleId: t.u64().index("btree"),
    shelterId: t.option(t.u64()),
    planId: t.u64(),
    status: t.string().index("btree"),
    stopOrder: t.u32(),
    etaMinutes: t.u32(),
    offeredAt: t.option(t.timestamp()),
    decidedAt: t.option(t.timestamp()),
  },
);

const callback = table(
  { name: "callback", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    requestId: t.u64().index("btree"),
    householdId: t.u64(),
    assignmentId: t.option(t.u64()),
    status: t.string(),
    line: t.string(),
    state: t.string().index("btree"),
    at: t.timestamp(),
  },
);

const roadClosure = table(
  { name: "road_closure", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    externalId: t.string().unique(),
    source: t.string(),
    street: t.string(),
    lat: t.f64(),
    lng: t.f64(),
    active: t.bool().index("btree"),
    at: t.timestamp(),
  },
);

const zone = table(
  { name: "zone", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    externalId: t.string().unique(),
    source: t.string(),
    name: t.string(),
    event: t.string(),
    severity: t.string(),
    rings: t.string(),
    active: t.bool().index("btree"),
    at: t.timestamp(),
  },
);

// Official warnings as the feed published them, for the map. One row per source and alert id.
// `geometry` is the alert's GeoJSON geometry, or "" when the alert has none (it is still listed).
// Holds only public alert text: no household, rider or call data.
const alert = table(
  { name: "alert", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(),
    alertId: t.string(),
    source: t.string(),
    event: t.string(),
    headline: t.string(),
    areaDescription: t.string(),
    geometry: t.string(),
    issuedAt: t.option(t.timestamp()),
    effectiveAt: t.option(t.timestamp()),
    expiresAt: t.option(t.timestamp()),
    status: t.string(),
    severity: t.string(),
    officialUrl: t.string(),
    active: t.bool().index("btree"),
    updatedAt: t.timestamp(),
  },
);

// Feed health, one row per source, so the map can tell "no active warnings" from "unable to refresh".
// state: loading (no poll finished yet), current (last poll succeeded), stale (last poll failed),
// off (no area configured).
const feedStatus = table(
  { name: "feed_status", public: true },
  {
    source: t.string().primaryKey(),
    state: t.string(),
    lastSuccessfulPollAt: t.option(t.timestamp()),
    lastAttemptAt: t.option(t.timestamp()),
    error: t.option(t.string()),
  },
);

const auditLog = table(
  { name: "audit_log", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    kind: t.string(),
    message: t.string(),
    at: t.timestamp(),
  },
);

const dispatchState = table(
  { name: "dispatch_state" },
  {
    id: t.u32().primaryKey(),
    running: t.bool(),
    lastReplanAt: t.option(t.timestamp()),
    roadVersion: t.u64(),
    roadVersionSeen: t.u64(),
  },
);

// One row, rewritten by the coverage sweep: how every home in the zone is accounted for.
const coverage = table(
  { name: "coverage", public: true },
  {
    id: t.u32().primaryKey(),
    at: t.timestamp(),
    inZone: t.u32(),
    leavingOnOwn: t.u32(),
    helped: t.u32(),
    helpRequested: t.u32(),
    escalated: t.u32(),
    doorCheck: t.u32(),
    reaching: t.u32(),
    // Found with nobody reaching them on this sweep, and put back on the ladder.
    overlooked: t.u32(),
  },
);

export const tickSchedule = table(
  { name: "tick_schedule" },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), generation: t.u64() },
);

export const offerExpiry = table(
  { name: "offer_expiry" },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), assignmentId: t.u64() },
);

export const reachStep = table(
  { name: "reach_step" },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), householdId: t.u64(), step: t.u32() },
);

export const replanJob = table(
  { name: "replan_job" },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() },
);

export const feedPoll = table(
  { name: "feed_poll" },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() },
);

export const spacetimedb = schema(
  {
    control,
    household,
    correction,
    call,
    transcriptLine,
    message,
    request,
    vehicle,
    shelter,
    plan,
    assignment,
    callback,
    roadClosure,
    zone,
    alert,
    feedStatus,
    auditLog,
    dispatchState,
    coverage,
    tickSchedule,
    offerExpiry,
    reachStep,
    replanJob,
    feedPoll,
  },
  {
    env: {
      SOLVER_URL: t.option(t.string()),
      SOLVER_TOKEN: t.option(t.string()),
      FEED_AREA: t.option(t.string()),
    },
  },
);
