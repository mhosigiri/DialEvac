import React, { useState } from "react";
import { drivingDirectionsUrl } from "../../../shared/route-guidance";
import { Button } from "../design-system/Button";

export const validCoordinates = (point: { lat: number; lng: number }) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
export const coordinateText = (point: { lat: number; lng: number }) => validCoordinates(point) ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : "Coordinates unavailable";

export function PickupLocation({ resident, responder }: { resident: { lat: number; lng: number; address: string }; responder?: { lat: number; lng: number; name: string } }) {
  const [copyState, setCopyState] = useState("");
  const available = validCoordinates(resident);
  return <section aria-label="Resident pickup location" style={{ margin: "12px 16px", padding: 12, border: "1px solid #3a465a", borderRadius: 10, background: "rgb(143 176 255 / 8%)" }}>
    <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>Resident pickup location</h3>
    <p style={{ margin: "0 0 6px", fontSize: 12.5 }}>{resident.address}</p>
    <p style={{ margin: 0, fontFamily: "monospace", fontSize: 14, color: "#b8cfff", userSelect: "all" }}>{coordinateText(resident)}</p>
    {responder && <p style={{ margin: "6px 0", color: "#c2c2c9", fontSize: 12 }}>Responder: {responder.name} · {coordinateText(responder)}</p>}
    <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 10 }}>
      <Button size="sm" variant="secondary" disabled={!available} onClick={() => {
        navigator.clipboard.writeText(coordinateText(resident)).then(() => setCopyState("Copied"), () => setCopyState("Copy unavailable; select the coordinates above"));
      }}>{copyState === "Copied" ? "Copied" : "Copy pickup coordinates"}</Button>
      {available && responder && validCoordinates(responder) && <a href={drivingDirectionsUrl(responder, resident)} target="_blank" rel="noopener noreferrer" style={{ color: "#8fb0ff", fontSize: 12 }}>Open driving directions</a>}
    </div>
    {copyState && copyState !== "Copied" && <p role="status" style={{ fontSize: 12 }}>{copyState}</p>}
  </section>;
}
