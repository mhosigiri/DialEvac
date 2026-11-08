import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IncidentMapFrame } from "../src/components/IncidentMapFrame";

test("the map card expands in place and never links to the standalone map", (t) => {
  Object.assign(globalThis, { window: { location: { href: "http://localhost:3002/" } } });
  t.after(() => { Reflect.deleteProperty(globalThis, "window"); });
  const html = renderToStaticMarkup(<IncidentMapFrame cases={[]} />);
  assert.ok(html.includes("Full screen"));
  assert.ok(!html.includes("<a "), "a link would open the standalone map without the portal's cases");
  assert.match(html, /<iframe[^>]+embed=1/);
});
