export type MapPoint = { lat: number; lng: number; label?: string };
export type DirectionsSnapshot = { origin: MapPoint; destination: MapPoint; points: readonly MapPoint[]; coveredBottom?: number };

export function directionsMapUrl(base: string | undefined, pageUrl: string, uri: string, database: string) {
  const page = new URL(pageUrl);
  const url = new URL(base || `${page.protocol}//${page.hostname}:4178/index.html`, page);
  url.searchParams.set("embed", "1");
  url.searchParams.set("directions", "1");
  url.searchParams.set("uri", uri);
  url.searchParams.set("db", database);
  return url.href;
}

// Both apps render the same MapLibre/OSM basemap and committed OSMnx geometry.
// Re-send after load/ready so a cold map never loses its destination or route.
export function bindDirectionsMap(frame: HTMLIFrameElement, snapshot: DirectionsSnapshot) {
  const mapOrigin = new URL(frame.src).origin;
  const send = () => {
    const post = (data: object) => frame.contentWindow?.postMessage(data, mapOrigin);
    post({ type: "dialevac:select", selection: { ...snapshot.destination, label: snapshot.destination.label || "Pickup address" } });
    post({ type: "dialevac:route", points: snapshot.points, origin: { ...snapshot.origin, label: snapshot.origin.label || "Responder" },
      coveredRight: 0, coveredBottom: snapshot.coveredBottom ?? 0 });
  };
  const message = (event: MessageEvent) => {
    if (event.source === frame.contentWindow && event.origin === mapOrigin && event.data?.type === "dialevac:ready") send();
  };
  frame.addEventListener("load", send);
  window.addEventListener("message", message);
  send();
  return () => {
    frame.removeEventListener("load", send);
    window.removeEventListener("message", message);
  };
}
