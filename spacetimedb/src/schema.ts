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
    source: t.string().index("btree"),
    name: t.string(),
    event: t.string(),
    severity: t.string(),
    rings: t.string(),
    active: t.bool().index("btree"),
    at: t.timestamp(),
    headline: t.option(t.string()).default(undefined),
    issuedAt: t.option(t.timestamp()).default(undefined),
    expiresAt: t.option(t.timestamp()).default(undefined),
    url: t.option(t.string()).default(undefined),
    messageType: t.option(t.string()).default(undefined),
    kind: t.option(t.string()).default(undefined),
    geometryJson: t.option(t.string()).default(undefined),
    area: t.option(t.string()).default(undefined),
  },
);

const feedHealth = table(
  { name: "feed_health", public: true },
  {
    id: t.u32().primaryKey(),
    provider: t.string(),
    area: t.string(),
    stale: t.bool(),
    lastOkAt: t.option(t.timestamp()),
    lastAttemptAt: t.option(t.timestamp()),
    error: t.option(t.string()),
    warningCount: t.u32(),
    radarValidAt: t.option(t.string()),
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

// A whole final conversation commits once, so duplicate deliveries cannot duplicate its turns.
const transcriptReceipt = table(
  { name: "transcript_receipt" },
  { providerId: t.string().primaryKey(), callId: t.u64().index("btree"), turnCount: t.u32(), at: t.timestamp() },
);

const callHandoff = table({ name: "call_handoff", public: true }, {
  callId: t.u64().primaryKey(), status: t.string(), targetLabel: t.string(), failureReason: t.option(t.string()),
  detail: t.option(t.string()), requestedAt: t.timestamp(), updatedAt: t.timestamp(),
});

const residentNotice = table({ name: "resident_notice" }, {
  key: t.string().primaryKey(), requestId: t.u64(), assignmentId: t.u64(), messageId: t.u64(), at: t.timestamp(),
});

export const routePoint = t.object("RoutePoint", { lat: t.f64(), lng: t.f64() });
const dispatchRoute = table({ name: "dispatch_route", public: true }, {
  assignmentId: t.u64().primaryKey(), requestId: t.u64().index("btree"), vehicleId: t.u64(),
  originLat: t.f64(), originLng: t.f64(), destinationLat: t.f64(), destinationLng: t.f64(), points: t.array(routePoint),
  distanceMeters: t.option(t.f64()), durationSeconds: t.option(t.f64()), source: t.string(), state: t.string(),
  failureReason: t.option(t.string()), revision: t.u64(), updatedAt: t.timestamp(),
});
export const routeJob = table({ name: "route_job" }, {
  scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), assignmentId: t.u64(), revision: t.u64(),
});
export const routeTimeout = table({ name: "route_timeout" }, {
  scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt(), assignmentId: t.u64(), revision: t.u64(),
});
const routeGuidance = table({ name: "route_guidance", public: true }, {
  assignmentId: t.u64().primaryKey(), revision: t.u64(), stepsJson: t.string(), summary: t.option(t.string()), model: t.option(t.string()),
  state: t.string(), error: t.option(t.string()), updatedAt: t.timestamp(),
});

const catastropheCase = table({ name: "catastrophe_case", public: true }, {
  householdId: t.u64().primaryKey(), zoneId: t.u64().index("btree"), hazard: t.string(), runId: t.string(),
  callId: t.option(t.u64()), duringSnapshotJson: t.option(t.string()), simulated: t.bool(), updatedAt: t.timestamp(),
});
const followUp = table({ name: "follow_up", public: true }, {
  householdId: t.u64().primaryKey(), requestId: t.u64(), state: t.string(), simulated: t.bool(),
  questions: t.array(t.object("FollowUpAnswer", { key: t.string(), prompt: t.string(), answer: t.string() })),
  duringSnapshotJson: t.string(), changesJson: t.string(),
  insuranceSelf: t.option(t.bool()), insuranceVehicle: t.option(t.bool()), insuranceProperty: t.option(t.bool()), updatedAt: t.timestamp(),
});

// Provider history is independent of household matching: an unknown caller must never be lost.
export const providerTranscriptTurn = t.object("ProviderTranscriptTurn", { speaker: t.string(), text: t.string() });
const callRecord = table({ name: "call_record", public: true }, {
  providerId: t.string().primaryKey(), agentId: t.string(), callId: t.option(t.u64()), householdId: t.option(t.u64()),
  direction: t.string(), status: t.string(), callerLabel: t.string(), startedAt: t.option(t.timestamp()), durationSeconds: t.option(t.f64()),
  turns: t.array(providerTranscriptTurn), revision: t.u64(), recordedAt: t.timestamp(), updatedAt: t.timestamp(),
});
const callAnalysis = table({ name: "call_analysis", public: true }, {
  providerId: t.string().primaryKey(), revision: t.u64(), state: t.string(), resultJson: t.option(t.string()),
  model: t.option(t.string()), error: t.option(t.string()), attempts: t.u32(), claimToken: t.option(t.string()),
  leaseUntil: t.option(t.timestamp()), nextAttemptAt: t.timestamp(), updatedAt: t.timestamp(),
});
const outboundDemoAttempt = table({ name: "outbound_demo_attempt", public: true }, {
  attemptId: t.string().primaryKey(), callId: t.u64(), householdId: t.u64(), createdAt: t.timestamp(),
});

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
    feedHealth,
    auditLog,
    dispatchState,
    coverage,
    tickSchedule,
    offerExpiry,
    reachStep,
    replanJob,
    feedPoll,
    transcriptReceipt,
    callHandoff,
    residentNotice,
    dispatchRoute,
    routeJob,
    routeTimeout,
    routeGuidance,
    catastropheCase,
    followUp,
    callRecord,
    callAnalysis,
    outboundDemoAttempt,
  },
  {
    env: {
      SOLVER_URL: t.option(t.string()),
      SOLVER_TOKEN: t.option(t.string()),
      FEED_AREA: t.option(t.string()),
      // Only a separately published demo database may run public fixture reducers.
      DEMO_MODE: t.option(t.string()),
      // Explicit authenticated caller identities. Absence grants nobody the role.
      OPERATOR_IDENTITIES: t.option(t.string()),
      SERVICE_IDENTITIES: t.option(t.string()),
      ROUTER_URL: t.option(t.string()),
    },
  },
);
