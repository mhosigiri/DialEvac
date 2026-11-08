import { spacetimedb } from "./schema";
import { control } from "./core";

// The module's entry. Every exported reducer and procedure becomes callable; the schema is the
// default export.

export default spacetimedb;

export const init = spacetimedb.init((ctx) => {
  control(ctx);
});

export { proposePlan } from "./plans";
export { approveOffer, acceptOffer, declineOffer, cancelByDriver, expireOffer } from "./offers";
export { importRiders, setZone, updateRecord, escalate, claimCall, callAnswered, callEnded, addTranscriptLine, markCallback, recordDigit, inboundCallEnded, claimMessage, messageSent, messageFailed, receiveMessage, closeRequest } from "./households";
export { runReachStep } from "./reach";
export { closeRoad, reopenRoad } from "./roads";
export { replan } from "./dispatch";
export { issueWarning, setStandIns, setHazardOrigin, endNight, seedStandInTown, seedTornadoDemo, tick } from "./loop";
export { pollFeeds, startFeeds } from "./feeds";
