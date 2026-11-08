import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import { MapPin, Radio, Truck } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Button, Txt } from "../components/ui";
import DeliveryMap, { MapPoint, validMapPoint } from "../components/DeliveryMap";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

type DriverOrder = { id: string; status: string; total: number; currency: string; createdAt?: string; address: Partial<MapPoint> & { name?: string; phone?: string; city?: string; street?: string }; tracking?: { location?: DriverPosition }; extras?: { mode?: string; etaMinutes?: number; contactless?: boolean; instructions?: string | null; tip?: number } | null };
type DriverPosition = MapPoint & { accuracy?: number | null; updatedAt: string };
const statusLabels: Record<string, string> = { pending: "بانتظار التأكيد", confirmed: "مؤكد", preparing: "قيد التجهيز", out_for_delivery: "قيد التوصيل", delivered: "تم التسليم", cancelled: "ملغي" };
const emptyOrders: DriverOrder[] = [];

export default function DriverScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const { user, configured, baseUrl } = useSession();
  const [receivedOrders, setReceivedOrders] = useState<{ ownerId: string; serverUrl: string; orders: DriverOrder[] } | null>(null);
  const orders = receivedOrders && receivedOrders.ownerId === user?.id && receivedOrders.serverUrl === baseUrl ? receivedOrders.orders : emptyOrders;
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [startingKey, setStartingKey] = useState("");
  const [sharingKey, setSharingKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [otp, setOtp] = useState("");
  const [storedPosition, setStoredPosition] = useState<{ key: string; location: DriverPosition } | null>(null);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const generation = useRef(0);
  const posting = useRef(false);
  const mounted = useRef(true);
  const ordersRef = useRef(orders);
  useEffect(() => { ordersRef.current = orders; }, [orders]);
  const selected = orders.find((order) => order.id === selectedId);
  // The server accepts driver coordinates only while the order is out for delivery (shoppers see them only then).
  const canShare = selected?.status === "out_for_delivery";
  const operationKey = `${user?.id || ""}:${selectedId}`;
  const starting = startingKey === operationKey;
  const sharing = canShare && sharingKey === operationKey;
  const position = storedPosition?.key === operationKey ? storedPosition.location : null;
  const releaseSensor = useCallback(() => {
    generation.current += 1;
    watcher.current?.remove();
    watcher.current = null;
  }, []);
  const stop = useCallback((message?: string) => {
    releaseSensor();
    if (mounted.current) { setSharingKey(""); setStartingKey(""); if (message) setNotice(message); }
  }, [releaseSensor]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") stop("توقفت مشاركة الموقع عند مغادرة التطبيق. ابدأها مجددًا عند عودتك."); });
    return () => { mounted.current = false; releaseSensor(); subscription.remove(); };
  }, [releaseSensor, stop]);
  useEffect(() => () => stop(), [user?.id, user?.role, configured, baseUrl, selectedId, canShare, stop]);
  const load = useCallback(async (visible = false) => {
    if (!configured || user?.role !== "driver") return;
    if (visible) setBusy(true);
    try {
      const data = await api.get<{ orders: DriverOrder[] }>("/driver/orders");
      setReceivedOrders({ ownerId: user.id, serverUrl: baseUrl, orders: data.orders });
      setError("");
      setSelectedId((id) => data.orders.some((order) => order.id === id) ? id : (data.orders.find((order) => !["delivered", "cancelled"].includes(order.status))?.id || data.orders[0]?.id || ""));
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل توصيلاتك"); }
    finally { if (visible) setBusy(false); }
  }, [baseUrl, configured, user]);
  useEffect(() => {
    const initial = setTimeout(() => void load(true), 0);
    const timer = setInterval(() => { if (AppState.currentState === "active" || AppState.currentState === null) void load(); }, 15000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [load]);
  const publish = async (location: Location.LocationObject, orderId: string, ticket: number) => {
    if (ticket !== generation.current || posting.current || !mounted.current) return;
    if (!validMapPoint(location.coords)) throw new Error("لم يرسل الجهاز إحداثيات صالحة. تحقق من تفعيل الموقع.");
    if (!ordersRef.current.some((order) => order.id === orderId && ["preparing", "out_for_delivery"].includes(order.status))) throw new Error("الطلب لم يعد متاحًا لمشاركة الموقع.");
    posting.current = true;
    try {
      const result = await api.post<{ location: DriverPosition }>(`/driver/orders/${encodeURIComponent(orderId)}/location`, { latitude: location.coords.latitude, longitude: location.coords.longitude, ...(typeof location.coords.accuracy === "number" ? { accuracy: location.coords.accuracy } : {}) });
      if (ticket === generation.current && mounted.current) { setStoredPosition({ key: operationKey, location: result.location }); setNotice("وصل تحديث الموقع إلى خادم المتجر."); setError(""); }
    } finally { posting.current = false; }
  };
  const start = async () => {
    if (!selected || !canShare) return;
    stop();
    const ticket = generation.current;
    const orderId = selected.id;
    setStartingKey(operationKey); setError(""); setNotice("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (ticket !== generation.current || !mounted.current) return;
      if (permission.status !== "granted") throw new Error(permission.canAskAgain ? "لم تمنح إذن الموقع. لن تُشارك أي إحداثيات دون موافقتك." : "إذن الموقع محظور. فعّله من إعدادات الهاتف أو المتصفح ثم أعد المحاولة.");
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (ticket !== generation.current || !mounted.current) return;
      await publish(current, orderId, ticket);
      if (ticket !== generation.current || !mounted.current) return;
      const subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 }, (next) => {
        void publish(next, orderId, ticket).catch((e) => { if (ticket === generation.current) { setError(e instanceof Error ? e.message : "تعذر إرسال الموقع"); stop("توقفت مشاركة الموقع بسبب تعذر الإرسال. أعد المحاولة بعد التحقق من الاتصال."); } });
      }, (reason) => { if (ticket === generation.current) { setError(tr("تعذر تحديث GPS: {reason}", { reason: String(reason) })); stop(); } });
      if (ticket !== generation.current || !mounted.current) { subscription.remove(); return; }
      watcher.current = subscription;
      setSharingKey(operationKey);
    } catch (e) { if (ticket === generation.current && mounted.current) { setError(e instanceof Error ? e.message : "تعذر بدء مشاركة الموقع"); stop(); } }
    finally { if (ticket === generation.current && mounted.current) setStartingKey(""); }
  };
  const updateStatus = async (status: "out_for_delivery" | "delivered") => {
    if (!selected) return;
    setBusy(true); setError("");
    try { await api.patch(`/driver/orders/${encodeURIComponent(selected.id)}`, status === "delivered" ? { status, otp: otp.trim() } : { status }); if (status === "delivered") setOtp(""); if (status === "delivered") stop("تم تسجيل التسليم وإيقاف مشاركة موقعك."); setNotice(status === "delivered" ? "حُفظ تأكيد تسليم الطلب في الخادم." : "أُبلغ العميل بأن الطلب خرج للتوصيل."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ حالة التوصيل"); }
    finally { setBusy(false); }
  };
  const openDirections = async () => {
    if (!selected) return;
    const destination = validMapPoint(selected.address as MapPoint) ? `${selected.address.latitude},${selected.address.longitude}` : [selected.address.street, selected.address.city].filter(Boolean).join(" ");
    if (!destination) return;
    try { await Linking.openURL(`https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(destination)}`); }
    catch { setError("تعذر فتح اتجاهات القيادة. استخدم عنوان التوصيل الظاهر."); }
  };
  const destination = validMapPoint(selected?.address as MapPoint | null) ? selected!.address as MapPoint : null;
  return <Shell title="توصيلاتي" subtitle="مساحة السائق: الطلبات المعيّنة لك ومشاركة موقعك بإذنك.">
    {!configured ? <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}><Txt>{tr("اربط التطبيق بخادم المتجر لاستلام الطلبات المعيّنة لك.")}</Txt><Button title="إعداد اتصال الخادم" onPress={() => router.push("/connection")} /></View> : !user ? <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}><Txt>{tr("سجّل الدخول بحساب السائق لعرض توصيلاتك.")}</Txt><Button title="تسجيل الدخول" onPress={() => router.push("/login")} /></View> : user.role !== "driver" ? <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}><Txt style={{ lineHeight: 25 }}>{tr("هذه المساحة لحسابات السائقين. يمكن لمسؤول المتجر تعيين دور السائق للحساب من لوحة الإدارة. لا يُسمح بمشاركة الموقع باسم حساب آخر.")}</Txt><Button title="العودة إلى حسابي" secondary onPress={() => router.push("/profile")} /></View> : <>
      <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}><View style={s.row}><Truck color={t.orange} size={25} /><Txt weight="bold" style={{ flex: 1, fontSize: 21 }}>{tr("طلبات التوصيل المعيّنة")}</Txt></View><Button title="تحديث توصيلاتي" secondary busy={busy} onPress={() => void load(true)} />{error ? <Txt accessibilityRole="alert" style={{ color: t.danger, lineHeight: 24 }}>{tr(error)}</Txt> : null}{notice ? <Txt accessibilityLiveRegion="polite" style={{ color: t.green, lineHeight: 23 }}>{tr(notice)}</Txt> : null}{!orders.length && !busy ? <Txt style={{ color: t.muted, lineHeight: 25 }}>{tr("لا توجد توصيلات معيّنة لك حاليًا. تظهر الطلبات بعد أن يعيّنها مسؤول المتجر لهذا الحساب.")}</Txt> : null}
        {orders.map((order) => <Pressable key={order.id} accessibilityRole="button" accessibilityLabel={tr("اختيار التوصيلة {id}", { id: order.id })} aria-selected={selectedId === order.id} onPress={() => setSelectedId(order.id)} style={[s.order, { backgroundColor: selectedId === order.id ? t.orangeSoft : t.background, borderColor: selectedId === order.id ? t.orange : t.line }]}><Txt weight="bold">{order.id}</Txt><Txt style={{ color: t.muted }}>{order.address.name || tr("العميل")} · {order.address.city || tr("العنوان محفوظ بالطلب")}</Txt><Txt style={{ color: t.orange }}>{tr(statusLabels[order.status] || order.status)}</Txt></Pressable>)}
      </View>
      {selected ? <View style={[s.card, { backgroundColor: t.paper, borderColor: t.line }]}>
        <View style={s.row}><MapPin color={t.orange} size={22} /><Txt weight="bold" style={{ flex: 1, fontSize: 20 }}>{tr("تفاصيل التوصيلة المختارة")}</Txt></View>
        <Txt weight="bold">{selected.address.name}</Txt><Txt>{[selected.address.street, selected.address.city].filter(Boolean).join("، ")}</Txt>{selected.address.phone ? <Txt selectable style={{ textAlign: "right", writingDirection: "ltr" }}>{selected.address.phone}</Txt> : null}
        {selected.extras?.mode === "express" ? <Txt weight="bold" style={{ color: t.orange }}>⚡ توصيل سريع{selected.extras.etaMinutes ? tr(" — خلال {minutes} دقيقة", { minutes: selected.extras.etaMinutes }) : ""}</Txt> : null}
        {selected.extras?.contactless ? <Txt weight="bold" style={{ color: t.green }}>بدون تلامس — اترك الطلب عند الباب</Txt> : null}
        {selected.extras?.instructions ? <Txt testID="driver-instructions" style={{ color: t.ink, backgroundColor: t.orangeSoft, padding: 10, borderRadius: 10 }}>تعليمات العميل: {selected.extras.instructions}</Txt> : null}
        {selected.extras?.tip ? <Txt style={{ color: t.green }}>إكرامية لك: {selected.extras.tip}</Txt> : null}
        <Button title="فتح اتجاهات القيادة" secondary onPress={() => void openDirections()} />
        <Txt style={{ color: t.muted, lineHeight: 25 }}>{tr("تعمل مشاركة الموقع أثناء بقاء التطبيق مفتوحًا في المقدمة فقط. تُرسل الإحداثيات إلى خادم المتجر ليشاهدها صاحب الطلب. تتوقف عند مغادرة التطبيق أو تغيير التوصيلة أو تسجيل الخروج.")}</Txt>
        {sharing ? <><View style={s.row}><Radio color={t.green} size={19} /><Txt weight="bold" style={{ color: t.green, flex: 1 }}>{tr("مشاركة الموقع مفعّلة لهذه التوصيلة")}</Txt></View><Button title="إيقاف مشاركة موقعي" secondary onPress={() => stop("أوقفت مشاركة الموقع. يبقى آخر موقع منشور مع وقت إرساله.")} /></> : <Button title="السماح بالموقع وبدء المشاركة" disabled={!canShare} busy={starting} onPress={() => void start()} />}
        {!canShare ? <Txt style={{ color: t.muted, fontSize: 13 }}>{tr("تبدأ مشاركة الموقع بعد تأكيد خروج الطلب للتوصيل، وتتوقف بعد التسليم أو الإلغاء.")}</Txt> : null}
        {position ? <><Txt style={{ color: t.muted, fontSize: 13 }}>{tr("آخر إرسال نجح: {time}", { time: new Date(position.updatedAt).toLocaleString(lang === "en" ? "en" : "ar") })}{typeof position.accuracy === "number" ? " · " + tr("دقة {m} مترًا", { m: Math.round(position.accuracy) }) : ""}</Txt><Txt selectable style={{ writingDirection: "ltr", textAlign: "left", color: t.muted }}>{position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}</Txt></> : null}
        <DeliveryMap driver={position} destination={destination} />
        {selected.status === "preparing" ? <Button title="تأكيد الخروج للتوصيل وإبلاغ العميل" busy={busy} onPress={() => void updateStatus("out_for_delivery")} /> : null}
        {selected.status === "out_for_delivery" ? <View style={{ gap: 8 }}>
          <Txt style={{ fontSize: 13 }}>{tr("اطلب من العميل رمز التسليم المكوّن من 4 أرقام الظاهر في تطبيقه.")}</Txt>
          <TextInput testID="driver-otp" accessibilityLabel={tr("رمز التسليم")} value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" maxLength={4} placeholder="0000" placeholderTextColor={t.muted} style={{ minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: t.line, backgroundColor: t.paper, color: t.ink, fontSize: 24, letterSpacing: 10, textAlign: "center", fontFamily: "Tajawal_700Bold" }} />
          <Button title="تأكيد تسليم الطلب للعميل" busy={busy} disabled={otp.length !== 4} onPress={() => void updateStatus("delivered")} />
        </View> : null}
        <Button title="عرض سجل تتبع هذه التوصيلة" secondary onPress={() => router.push(`/tracking/${selected.id}`)} />
      </View> : null}
    </>}
  </Shell>;
}
const s = StyleSheet.create({ card: { padding: 20, borderRadius: 19, borderWidth: 1, gap: 15, marginBottom: 18 }, row: { flexDirection: "row-reverse", alignItems: "center", gap: 12 }, order: { borderRadius: 13, borderWidth: 1, padding: 15, gap: 7 } });
