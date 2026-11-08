// Shared browser-safe connection targets. Credentials stay in each client's environment.
export const SPACETIME_URI = "wss://maincloud.spacetimedb.com";
export const SPACETIME_DATABASE = "hackutd-535md";
export const SPACETIME_DATABASE_ID = "c200cf51b3a0ff31fe1b176b3d4c0999c57b3314b9544bfc10e76c6501e0caab";
export const SPACETIME_DEMO_DATABASE = "hackutd-richardson";

// http/https and ws/wss are aliases for the same database host.
export function databaseHost(uri: string) {
  return new URL(uri.replace(/^ws/i, "http")).host.toLowerCase();
}

export function separateDemoDatabase(demoUri: string, demoDatabase: string, liveUri: string, liveDatabase: string) {
  try {
    if (databaseHost(demoUri) === databaseHost(SPACETIME_URI) && [SPACETIME_DATABASE, SPACETIME_DATABASE_ID].includes(demoDatabase)) return false;
    return databaseHost(demoUri) !== databaseHost(liveUri) || demoDatabase !== liveDatabase;
  } catch {
    return false;
  }
}
