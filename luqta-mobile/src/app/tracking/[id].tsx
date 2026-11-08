import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { MapPin, Navigation, Truck } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { Button, Row, Txt } from "../../components/ui";
import { OrderSteps } from "../../components/OrderSteps";
import DeliveryMap, { MapPoint, validMapPoint } from "../../components/DeliveryMap";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";
import { distanceBetweenMeters, fetchDrivingRoute, type DrivingRoute } from "../../lib/deliveryRoute";

type Tracking = {
  orderId: string;
  status: string;
  driver: { id: string; name: string } | null;
  location: (MapPoint & { accuracy?: number | null; updatedAt: string }) | null;
  destination: (Partial<MapPoint> & { name?: string; phone?: string; city?: string; street?: string }) | null;
  events: { status: string; at: string; note?: string }[];
  updatedAt?: string;
};
type RouteSnapshot = {
  identity: string;
  origin: MapPoint;
  destination: MapPoint;
  data: DrivingRoute;
  calculatedAt: string;
};
const labels: Record<string, string> = { pending: "بانتظار التأكيد", confirmed: "تم التأكيد", preparing: "جارٍ التجهيز", out_for_delivery: "في الطريق إليك", delivered: "تم التسليم", cancelled: "ملغي" };
function dateLabel(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "الوقت غير متاح";
  return new Date(value).toLocaleString("ar", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TrackingScreen() {
  const { colors: t } = useTheme();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user, configured, baseUrl } = useSession();
  const [received, setReceived] = useState<{ ownerId: string; serverUrl: string; data: Tracking } | null>(null);
  const tracking = received && received.ownerId === user?.id && received.serverUrl === baseUrl && received.data.orderId === id ? received.data : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [routeSnapshot, setRouteSnapshot] = useState<RouteSnapshot | null>(null);
  const [routeFailure, setRouteFailure] = useState<{ identity: string; message: string } | null>(null);
  const [routingIdentity, setRoutingIdentity] = useState<string | null>(null);
  const [routeRetry, setRouteRetry] = useState(0);
  const lastRouteResult = useRef<{ identity: string; origin: MapPoint; destination: MapPoint; at: number; retry: number } | null>(null);
  const load = useCallback(async (visible = false) => {
    if (!id || !user || !configured) return;
    if (visible) setBusy(true);
    try {
      const data = await api.get<Tracking>(`/orders/${encodeURIComponent(id)}/tracking`);
      setReceived({ ownerId: user.id, serverUrl: baseUrl, data });
      setError("");
      setCheckedAt(new Date().toISOString());
      setClock(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحديث تتبع الطلب");
    } finally { setClock(Date.now()); if (visible) setBusy(false); }
  }, [baseUrl, configured, id, user]);
  useEffect(() => {
    const initial = setTimeout(() => void load(true), 0);
    const timer = setInterval(() => { if (AppState.currentState === "active" || AppState.currentState === null) void load(); }, 15000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [load]);
  const destination = validMapPoint(tracking?.destination as MapPoint | null) ? tracking!.destination as MapPoint : null;
  const location = validMapPoint(tracking?.location) ? tracking!.location : null;
  const age = location && Number.isFinite(Date.parse(location.updatedAt)) ? Math.max(0, Math.floor((clock - Date.parse(location.updatedAt)) / 1000)) : null;
  const stale = age === null || age > 90;
  const routeIdentity = `${baseUrl}:${user?.id || ""}:${id || ""}`;
  const routeEligible = Boolean(tracking?.status === "out_for_delivery" && !stale && location && destination);
  const driverLat = location?.latitude, driverLng = location?.longitude;
  const destinationLat = destination?.latitude, destinationLng = destination?.longitude;
  useEffect(() => {
    if (!routeEligible || driverLat === undefined || driverLng === undefined || destinationLat === undefined || destinationLng === undefined) return;
    const start = { latitude: driverLat, longitude: driverLng };
    const end = { latitude: destinationLat, longitude: destinationLng };
    const previous = lastRouteResult.current;
    if (previous && previous.identity === routeIdentity && previous.retry === routeRetry && Date.now() - previous.at < 60_000 &&
        distanceBetweenMeters(previous.origin, start) < 150 && distanceBetweenMeters(previous.destination, end) < 10) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      setRoutingIdentity(routeIdentity);
      setRouteFailure(null);
      fetchDrivingRoute(start, end, { signal: controller.signal }).then((data) => {
        if (!active) return;
        lastRouteResult.current = { identity: routeIdentity, origin: start, destination: end, at: Date.now(), retry: routeRetry };
        setRouteSnapshot({ identity: routeIdentity, origin: start, destination: end, data, calculatedAt: new Date().toISOString() });
      }).catch((failure) => {
        if (!active || controller.signal.aborted) return;
        lastRouteResult.current = { identity: routeIdentity, origin: start, destination: end, at: Date.now(), retry: routeRetry };
        setRouteSnapshot(null);
        setRouteFailure({ identity: routeIdentity, message: failure instanceof Error ? failure.message : "تعذر حساب المسار." });
      }).finally(() => { if (active) setRoutingIdentity(null); });
    }, 0);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [routeEligible, routeIdentity, driverLat, driverLng, destinationLat, destinationLng, routeRetry]);
  const activeRoute = routeEligible && routeSnapshot?.identity === routeIdentity && location && destination &&
    distanceBetweenMeters(routeSnapshot.origin, location) < 150 && distanceBetweenMeters(routeSnapshot.destination, destination) < 10
      ? routeSnapshot : null;
  const routing = routeEligible && routingIdentity === routeIdentity;
  const routeError = routeEligible && routeFailure?.identity === routeIdentity ? routeFailure.message : "";
  const [deliveryCode, setCode] = useState<string | null>(null);
  const status = tracking?.status;
  useEffect(() => { if (!id || status !== "out_for_delivery") return; api.get<{ code: string | null }>(`/orders/${encodeURIComponent(id)}/delivery-code`).then((r) => setCode(r.code)).catch(() => setCode(null)); }, [id, status]);
  const code = status === "out_for_delivery" ? deliveryCode : null;
  const cancel = async () => { if (!id) return; setBusy(true); try { await api.post(`/orders/${encodeURIComponent(id)}/cancel`, {}); await load(true); } catch (e) { setError(e instanceof Error ? e.message : "تعذر إلغاء الطلب"); } finally { setBusy(false); } };
  const openDestination = async () => {
    const query = destination ? `${destination.latitude},${destination.longitude}` : [tracking?.destination?.street, tracking?.destination?.city].filter(Boolean).join(" ");
    if (!query) return;
    try { await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`); }
    catch { setError("تعذر فتح تطبيق الخرائط. يمكنك استخدام العنوان الظاهر أدناه."); }
  };
  return <Shell title="تتبع الطلب" subtitle="الموقع المنشور من جهاز السائق، مع وقت آخر تحديث حقيقي." robot={tracking?.status === "out_for_delivery" ? "طلبك بالطريق! 🛵" : undefined} back testID="tracking">
    {!configured ? <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}><Txt>يجب ربط التطبيق بخادم المتجر قبل تتبع الطلبات.</Txt><Button title="إعداد اتصال الخادم" onPress={() => router.push("/connection")} /></View> : !user ? <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}><Txt>سجّل الدخول إلى الحساب صاحب الطلب لعرض موقع التوصيل.</Txt><Button title="تسجيل الدخول" onPress={() => router.push("/login")} /></View> : <>
      <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}>
        <View style={s.row}><Truck size={26} color={t.orange} /><View style={{ flex: 1, gap: 5 }}><Txt weight="bold" style={{ fontSize: 21 }}>{tracking ? labels[tracking.status] || tracking.status : "تتبع الطلب"}</Txt><Txt style={{ color: t.muted, fontSize: 13 }}>{id || "رقم الطلب غير صالح"}</Txt></View>{busy ? <ActivityIndicator color={t.orange} /> : null}</View>
        {error ? <Txt accessibilityRole="alert" style={{ color: t.danger, lineHeight: 24 }}>{error}{tracking ? " — المعروض أدناه آخر بيانات ناجحة، وقد لا يكون محدثًا." : ""}</Txt> : null}
        <Button title="تحديث حالة وموقع الطلب" secondary busy={busy} disabled={!id} onPress={() => void load(true)} />
        {tracking ? <OrderSteps status={tracking.status} /> : null}
        {code ? <View testID="delivery-code" style={{ backgroundColor: t.primarySoft, borderRadius: 16, padding: 14, gap: 4 }}><Txt weight="bold" style={{ color: t.primary }}>رمز التسليم</Txt><Txt weight="extra" style={{ fontSize: 30, letterSpacing: 8, textAlign: "center", color: t.primary }}>{code}</Txt><Txt style={{ fontSize: 12, color: t.muted }}>أعطه للسائق عند استلام الطلب فقط.</Txt></View> : null}
        <Row wrap>
          <Button title="تفاصيل الطلب" secondary onPress={() => router.push(`/order/${id}`)} style={{ flex: 1 }} />
          <Button title="الدعم" secondary onPress={() => router.push({ pathname: "/support", params: { orderId: id } })} style={{ flex: 1 }} />
          {tracking && ["pending", "confirmed"].includes(tracking.status) ? <Button title="إلغاء" tone="danger" testID="cancel-order" onPress={() => void cancel()} style={{ flex: 1 }} /> : null}
        </Row>
        {checkedAt ? <Txt style={{ color: t.muted, fontSize: 12 }}>آخر اتصال بالخادم: {dateLabel(checkedAt)} · تحديث تلقائي كل 15 ثانية أثناء فتح التطبيق.</Txt> : null}
      </View>
      {tracking ? <>
        <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}>
          <View style={s.row}><Navigation size={22} color={t.green} /><Txt weight="bold" style={{ flex: 1, fontSize: 19 }}>موقع السائق</Txt></View>
          <Txt>{tracking.driver ? `السائق المعيّن: ${tracking.driver.name}` : "لم يُعيّن سائق لهذا الطلب بعد."}</Txt>
          {location ? <>
            <Txt style={{ color: stale ? t.danger : t.green }}>{stale ? "آخر موقع قديم؛ لا يدل على مكان السائق الآن." : "موقع حديث منشور من جهاز السائق."}</Txt>
            <Txt style={{ color: t.muted, fontSize: 13, lineHeight: 23 }}>آخر إرسال: {dateLabel(location.updatedAt)}{age !== null ? ` · منذ ${age} ثانية` : ""}{typeof location.accuracy === "number" ? ` · دقة تقريبية ${Math.round(location.accuracy)} مترًا` : ""}</Txt>
            <Txt selectable style={{ direction: "ltr", textAlign: "left", color: t.muted, fontSize: 13 }}>{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</Txt>
          </> : <Txt style={{ color: t.muted, lineHeight: 25 }}>لم يشارك السائق إحداثيات لهذا الطلب بعد. لا يُعرض موقع افتراضي أو حركة تجريبية.</Txt>}
          {routeEligible ? <View style={{ gap: 8 }}>
            {routing ? <View style={s.row}><ActivityIndicator color={t.orange} /><Txt>جارٍ حساب طريق القيادة…</Txt></View> : null}
            {activeRoute ? <>
              <Txt weight="bold" style={{ color: t.green }}>
                مسافة القيادة التقريبية {(activeRoute.data.distanceMeters / 1000).toLocaleString("ar-JO", { maximumFractionDigits: 1 })} كم · نحو {Math.max(1, Math.ceil(activeRoute.data.durationSeconds / 60)).toLocaleString("ar-JO")} دقيقة قيادة
              </Txt>
              <Txt style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>حُسب الطريق عند {dateLabel(activeRoute.calculatedAt)} من آخر موقع منشور. الوقت تقديري ولا يشمل التوقف أو وقت تجهيز الطلب.</Txt>
            </> : null}
            {routeError ? <><Txt accessibilityRole="alert" style={{ color: t.muted, lineHeight: 23 }}>{routeError} تُعرض النقطتان بخط مباشر فقط دون وقت وصول.</Txt><Button title="إعادة محاولة حساب المسار" secondary onPress={() => setRouteRetry((value) => value + 1)} /></> : null}
          </View> : null}
          <DeliveryMap driver={location} destination={destination} route={activeRoute?.data.points ?? null} height={320} />
        </View>
        <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}>
          <View style={s.row}><MapPin size={21} color={t.orange} /><Txt weight="bold" style={{ flex: 1, fontSize: 19 }}>عنوان التوصيل</Txt></View>
          <Txt>{[tracking.destination?.street, tracking.destination?.city].filter(Boolean).join("، ") || "لا تتوفر تفاصيل عنوان إضافية."}</Txt>
          {!destination ? <Txt style={{ color: t.muted, fontSize: 13, lineHeight: 23 }}>العنوان لا يحتوي على إحداثيات محفوظة؛ قد يتطلب البحث في الخرائط تحديد الموقع يدويًا.</Txt> : null}
          {(destination || tracking.destination?.street || tracking.destination?.city) ? <Button title="فتح عنوان التوصيل في الخرائط" secondary onPress={() => void openDestination()} /> : null}
        </View>
        <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}><Txt weight="bold" style={{ fontSize: 19 }}>سجل مراحل الطلب</Txt>{tracking.events?.length ? tracking.events.map((event, index) => <View key={`${event.at}-${index}`} style={{ borderRightWidth: 3, borderColor: t.orangeSoft, paddingRight: 14, gap: 5 }}><Txt weight="bold">{labels[event.status] || event.status}</Txt><Txt style={{ color: t.muted, fontSize: 13 }}>{dateLabel(event.at)}</Txt>{event.note ? <Txt style={{ color: t.muted, fontSize: 13 }}>{event.note}</Txt> : null}</View>) : <Txt style={{ color: t.muted }}>لم تُسجّل مراحل بعد.</Txt>}</View>
      </> : null}
    </>}
  </Shell>;
}
const s = StyleSheet.create({ card: { padding: 20, borderRadius: 19, borderWidth: 1, gap: 15, marginBottom: 18 }, row: { flexDirection: "row-reverse", alignItems: "center", gap: 12 } });
