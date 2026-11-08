import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Timestamp } from "spacetimedb";
import { OFFER_SECONDS } from "../../shared/offer-timing";
import { buildDriverStops, type DriverStop } from "../src/lib/driver-state";
import { getManeuverIcon } from "../src/lib/navigation-icons";
import { LiveOfferModal } from "../src/components/LiveOfferModal";
import { NavigationMap } from "../src/components/NavigationMap";
import { RunList } from "../src/components/RunList";
import { TurnByTurnNav } from "../src/components/TurnByTurnNav";
import type { Assignment, DispatchRoute, Household, Request, RouteGuidance, Vehicle } from "../src/module_bindings/types";

const origin = { lat: 29.77, lng: -95.405 };
const destination = { lat: 29.7627, lng: -95.3973 };
const roadPoints = [origin, { lat: 29.7705, lng: -95.4 }, { lat: 29.7612, lng: -95.3965 }, destination];

test("the navigation map uses an embedded street basemap and overlays the current Gemini brief", () => {
  const html = renderToStaticMarkup(<NavigationMap origin={origin} destination={destination} points={roadPoints} summary="Use Washington Avenue" model="gemini-test" />);
  assert.ok(html.includes('title="OpenStreetMap driving navigation"'));
  assert.ok(html.includes('directions=1'));
  assert.ok(html.includes('OSMnx road route'));
  assert.ok(html.includes('Gemini map overlay'));
  assert.ok(html.includes('Use Washington Avenue'));
  assert.ok(!html.includes('<svg'));
});

test("a missing route shows a waiting state, without fabricated road geometry or GPS claims", () => {
  const html = renderToStaticMarkup(<NavigationMap origin={origin} destination={origin} points={[]} />);
  assert.ok(html.includes('Waiting for a road route'));
  assert.ok(!html.includes('GPS Signal Active'));
  assert.ok(!html.includes('OSMnx road route'));
  assert.ok(!html.includes('NaN'));
});

const home = { id: 1n, name: "Demo resident", address: "1 Main", lat: destination.lat, lng: destination.lng, simulated: true } as Household;
const vehicle = { id: 2n, name: "Demo responder", ...origin } as Vehicle;
const request = { id: 3n, householdId: 1n, status: "en_route", people: 1, mobility: "walks", assistance: "none", etaMinutes: 2 } as Request;
const assignment = { id: 4n, requestId: 3n, vehicleId: 2n, status: "accepted", stopOrder: 1, etaMinutes: 9 } as Assignment;
const stop = buildDriverStops([assignment], [request], [home], [], vehicle.id)[0];

test("a stop reports the live request ETA, not the ETA frozen at offer time", () => {
  assert.equal(stop.etaMinutes, 2);
});

test("a zero ETA does not print a stray 0 on the run list", () => {
  const html = renderToStaticMarkup(<RunList stops={[{ ...stop, etaMinutes: 0 } as DriverStop]} onSelectStop={() => {}} onCancelStop={() => {}} busy={false} />);
  assert.ok(!html.includes(">0<"));
  assert.ok(html.includes("Pickup Stop"));
});

const offerAgo = (seconds: number) =>
  renderToStaticMarkup(
    <LiveOfferModal
      assignment={{ ...assignment, status: "offered", offeredAt: Timestamp.fromDate(new Date(Date.now() - seconds * 1000)) } as Assignment}
      request={request}
      household={home}
      onAccept={() => {}}
      onDecline={() => {}}
      busy={false}
    />,
  );

test("the offer countdown measures the server's real expiry from when the offer was made", () => {
  const html = offerAgo(OFFER_SECONDS - 90);
  assert.ok(/1:(30|29)/.test(html), "90 seconds should remain");
});

test("reopening the app does not restart an offer's countdown, and it stops at zero", () => {
  assert.ok(/0:(10|09)/.test(offerAgo(OFFER_SECONDS - 10)));
  assert.ok(offerAgo(OFFER_SECONDS + 300).includes("0:00"));
});

test("an offer with no recorded start shows no made-up deadline", () => {
  const html = renderToStaticMarkup(
    <LiveOfferModal assignment={{ ...assignment, status: "offered", offeredAt: undefined } as Assignment} request={request} household={home} onAccept={() => {}} onDecline={() => {}} busy={false} />,
  );
  assert.ok(!/\b\d:\d\d\b/.test(html));
  assert.ok(html.includes("ACCEPT RUN"));
});

test("the next turn is announced at the distance left on the current road, not the length of the next road", () => {
  const steps = [
    { instruction: "Depart left on Snover Street", road: "Snover Street", distanceMeters: 41, durationSeconds: 5, ...origin },
    { instruction: "Turn right on Washington Avenue", road: "Washington Avenue", distanceMeters: 617, durationSeconds: 40, lat: 29.771, lng: -95.404 },
    { instruction: "Arrive at the destination", road: "", distanceMeters: 0, durationSeconds: 0, ...destination },
  ];
  const route = { assignmentId: assignment.id, revision: 1n, state: "ready", originLat: origin.lat, originLng: origin.lng, destinationLat: destination.lat, destinationLng: destination.lng, points: roadPoints, distanceMeters: 658, durationSeconds: 45 } as DispatchRoute;
  const guidance = { assignmentId: assignment.id, revision: 1n, state: "ready", stepsJson: JSON.stringify(steps) } as RouteGuidance;
  const html = renderToStaticMarkup(<TurnByTurnNav stop={stop} vehicle={vehicle} route={route} guidance={guidance} roadClosures={[]} onRequestRoute={() => {}} busy={false} />);
  assert.ok(html.includes("Turn right on Washington Avenue in 135 ft"));
  assert.ok(!html.includes("Washington Avenue in 2024 ft"));
  assert.ok(html.includes("for 135 ft"));
});

test("the maneuver arrow follows the maneuver, not letters in the road name", () => {
  const icon = (instruction: string) => renderToStaticMarkup(getManeuverIcon(instruction));
  const [straight, left, right] = [icon("Continue straight"), icon("Turn left"), icon("Turn right")];
  assert.equal(icon("Continue on Bright Road"), straight);
  assert.equal(icon("Continue on Left Bank Drive"), straight);
  assert.equal(icon("Turn left on Wright Street"), left);
  assert.equal(icon("Turn right on Cleft Lane"), right);
  assert.notEqual(icon("Arrive at the destination"), straight);
  assert.notEqual(icon("Turn with a U-turn on Main Street"), straight);
});
