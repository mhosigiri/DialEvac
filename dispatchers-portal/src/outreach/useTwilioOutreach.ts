import { useCallback, useEffect, useRef, useState } from "react";
import { parseOutreachResponse, type OutreachBatch } from "../../../shared/outreach";
import type { Catastrophe } from "../../../shared/catastrophe-triage";

export function useTwilioOutreach() {
  const [batch, setBatch] = useState<OutreachBatch>();
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string>();
  const [connected, setConnected] = useState(false);
  const attempt = useRef<string | undefined>(sessionStorage.getItem("twilio-outreach-attempt") ?? undefined);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/outreach", { signal: AbortSignal.timeout(5000), cache: "no-store" });
        if (!response.ok) { if (active) setConnected(false); return; }
        const batch = parseOutreachResponse(await response.json());
        if (active) {
          setBatch(current => current?.batchId === attempt.current && batch?.batchId !== attempt.current ? current : batch ?? current);
          setConnected(true);
        }
      } catch { if (active) setConnected(false); }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 2000);
    return () => { active = false; clearInterval(interval); };
  }, []);
  const launch = useCallback(async (category: Catastrophe) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setLaunching(true); setError(undefined);
    attempt.current ??= crypto.randomUUID();
    sessionStorage.setItem("twilio-outreach-attempt", attempt.current);
    try {
      const response = await fetch("/api/outreach/launch", { method: "POST", headers: { "content-type": "application/json", "x-outreach-request": "launch" },
        body: JSON.stringify({ batchId: attempt.current, category }), signal: AbortSignal.timeout(65000) });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "Unable to launch Twilio outreach";
        throw new Error(message);
      }
      const batch = parseOutreachResponse(result);
      if (!batch) throw new Error("No call submission receipt was returned");
      setBatch(batch); setConnected(true);
      if (batch.contacts.every(contact => contact.phase === "failed")) { setError("All three call submissions were refused. No automatic retry was made."); return false; }
      return true;
    } catch (error) {
      setError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Call submission outcome is unknown. Check call status before trying again.");
      return false;
    } finally { inFlight.current = false; setLaunching(false); }
  }, []);
  return { batch, launching, error, connected, launch, hasLaunched: Boolean(batch && batch.batchId === attempt.current), resetAttempt: () => { attempt.current = undefined; sessionStorage.removeItem("twilio-outreach-attempt"); setError(undefined); } };
}
