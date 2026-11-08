import { validMapPoint, type MapPoint } from "../components/deliveryMapHtml.ts";

export type DrivingRoute = {
  points: MapPoint[];
  distanceMeters: number;
  durationSeconds: number;
};

// The public OSRM service supports this prototype. Production needs a routing
// service with an availability agreement and its own usage policy.
const publicRouter = "https://router.project-osrm.org";

export function drivingRouteUrl(start: MapPoint, destination: MapPoint, endpoint = publicRouter): string {
  if (!validMapPoint(start) || !validMapPoint(destination)) throw new Error("إحداثيات المسار غير صالحة.");
  const coordinate = (point: MapPoint) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
  return `${endpoint.replace(/\/$/, "")}/route/v1/driving/${coordinate(start)};${coordinate(destination)}?overview=simplified&geometries=geojson&steps=false`;
}

export function parseDrivingRoute(value: unknown): DrivingRoute {
  if (!value || typeof value !== "object" || (value as { code?: unknown }).code !== "Ok") {
    throw new Error("لم تتمكن خدمة المسارات من حساب طريق قيادة.");
  }
  const routes = (value as { routes?: unknown }).routes;
  const route = Array.isArray(routes) ? routes[0] : null;
  if (!route || typeof route !== "object") throw new Error("لا يوجد طريق قيادة متاح بين النقطتين.");
  const { distance, duration, geometry } = route as {
    distance?: unknown;
    duration?: unknown;
    geometry?: { type?: unknown; coordinates?: unknown };
  };
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0 ||
      typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 ||
      geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length < 2 || geometry.coordinates.length > 5000) {
    throw new Error("رد خدمة المسارات غير صالح.");
  }
  const points: MapPoint[] = geometry.coordinates.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== "number" || typeof entry[1] !== "number") {
      throw new Error("إحداثيات الطريق غير صالحة.");
    }
    const point = { longitude: entry[0], latitude: entry[1] };
    if (!validMapPoint(point)) throw new Error("إحداثيات الطريق غير صالحة.");
    return point;
  });
  return { points, distanceMeters: distance, durationSeconds: duration };
}

export function distanceBetweenMeters(a: MapPoint, b: MapPoint): number {
  if (!validMapPoint(a) || !validMapPoint(b)) return Number.POSITIVE_INFINITY;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat = radians(b.latitude - a.latitude);
  const lng = radians(b.longitude - a.longitude);
  const inside = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(inside)));
}

export async function fetchDrivingRoute(
  start: MapPoint,
  destination: MapPoint,
  options: { signal?: AbortSignal; endpoint?: string; fetcher?: typeof fetch } = {},
): Promise<DrivingRoute> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await (options.fetcher || fetch)(drivingRouteUrl(start, destination, options.endpoint), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("خدمة المسارات غير متاحة الآن.");
    return parseDrivingRoute(await response.json());
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
