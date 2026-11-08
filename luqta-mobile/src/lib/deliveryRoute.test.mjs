import { strict as assert } from "node:assert";
import { test } from "node:test";
import { deliveryMapHtml } from "../components/deliveryMapHtml.ts";
import { distanceBetweenMeters, drivingRouteUrl, fetchDrivingRoute, parseDrivingRoute } from "./deliveryRoute.ts";

const driver = { latitude: 31.949, longitude: 35.925 };
const destination = { latitude: 31.963, longitude: 35.941 };
const osrmBody = {
  code: "Ok",
  routes: [{
    distance: 6138.1,
    duration: 538,
    geometry: { type: "LineString", coordinates: [[35.925, 31.949], [35.931, 31.954], [35.941, 31.963]] },
  }],
};

test("requests driving coordinates in longitude-latitude order", () => {
  assert.match(drivingRouteUrl(driver, destination), /35\.925000,31\.949000;35\.941000,31\.963000/);
  assert.throws(() => drivingRouteUrl({ latitude: 95, longitude: 35 }, destination));
});

test("parses and draws an actual route response without swapping coordinates", () => {
  const route = parseDrivingRoute(osrmBody);
  assert.equal(route.distanceMeters, 6138.1);
  assert.equal(route.durationSeconds, 538);
  assert.deepEqual(route.points[0], driver);
  assert.deepEqual(route.points.at(-1), destination);
  assert.match(deliveryMapHtml({ driver, destination, route: route.points }), /35\.931/);
});

test("rejects missing routes and invalid geometry rather than inventing an ETA", () => {
  assert.throws(() => parseDrivingRoute({ code: "NoRoute", routes: [] }));
  assert.throws(() => parseDrivingRoute({ code: "Ok", routes: [] }));
  assert.throws(() => parseDrivingRoute({ code: "Ok", routes: [{ ...osrmBody.routes[0], geometry: { type: "LineString", coordinates: [[999, 31], [35, 32]] } }] }));
});

test("fetches route data and rejects failed providers", async () => {
  const called = [];
  const route = await fetchDrivingRoute(driver, destination, {
    fetcher: async (url) => { called.push(url); return { ok: true, json: async () => osrmBody }; },
  });
  assert.equal(route.durationSeconds, 538);
  assert.equal(called.length, 1);
  await assert.rejects(fetchDrivingRoute(driver, destination, {
    fetcher: async () => ({ ok: false }),
  }), /غير متاحة/);
  assert.ok(distanceBetweenMeters(driver, destination) > 1000);
});
