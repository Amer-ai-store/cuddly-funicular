import React, { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { FileText, Headset, MapPin, RotateCcw, Star, Undo2, PartyPopper } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { OrderSteps } from "../../components/OrderSteps";
import { Mascot } from "../../components/Robot";
import { Badge, Button, Card, EmptyState, Field, KeyValue, Notice, Row, Txt } from "../../components/ui";
import { useStore } from "../../lib/store";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useMoney } from "../../lib/money";
import { api } from "../../lib/api";
import { orderLabels, type CommerceOrder } from "../../lib/commerce-types";

const PAY: Record<string, string> = { cod: "الدفع عند الاستلام", wallet: "رصيد المحفظة", card: "بطاقة (تجريبي)" };

export default function OrderScreen() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { id, placed } = useLocalSearchParams<{ id: string; placed?: string }>();
  const { user, configured } = useSession();
  const { reorder, refreshOrders } = useStore();
  const [order, setOrder] = useState<CommerceOrder | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [driverRating, setDriverRating] = useState(0);
  const [comment, setComment] = useState("");
  const load = useCallback(async () => {
    if (!id || !user || !configured) return;
    try {
      const result = await api.get<{ order: CommerceOrder }>(`/orders/${encodeURIComponent(id)}`);
      setOrder(result.order);
      if (result.order.status === "out_for_delivery") setCode((await api.get<{ code: string | null }>(`/orders/${encodeURIComponent(id)}/delivery-code`)).code);
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل الطلب"); }
  }, [id, user, configured]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (!user) return <Shell title="تفاصيل الطلب"><EmptyState title="سجّل الدخول" detail="تحتاج إلى حساب صاحب الطلب." action="تسجيل الدخول" href="/login" /></Shell>;
  if (!order) return <Shell title="تفاصيل الطلب" back>{error ? <Notice text={error} tone="danger" /> : <Txt style={{ color: t.muted }}>{tr("جارٍ التحميل…")}</Txt>}</Shell>;
  const extras = order.extras || {};
  async function cancel() {
    setBusy(true);
    try { const r = await api.post<{ order: CommerceOrder }>(`/orders/${encodeURIComponent(order!.id)}/cancel`, {}); setOrder(r.order); void refreshOrders(); } catch (e) { setError(e instanceof Error ? e.message : "تعذر الإلغاء"); } finally { setBusy(false); }
  }
  async function rate() {
    setBusy(true);
    try { await api.post(`/orders/${encodeURIComponent(order!.id)}/rating`, { rating, driverRating: driverRating || undefined, comment: comment.trim() || undefined }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ التقييم"); } finally { setBusy(false); }
  }
  const stars = (value: number, set: (n: number) => void, label: string) => (
    <Row gap={4}>{[1, 2, 3, 4, 5].map((n) => <Pressable key={n} testID={`${label}-${n}`} accessibilityRole="button" accessibilityLabel={`${n}`} onPress={() => set(n)} style={{ padding: 4 }}><Star size={26} color={t.warning} fill={n <= value ? t.warning : "transparent"} /></Pressable>)}</Row>
  );
  return (
    <Shell title={placed ? "تم استلام طلبك!" : "تفاصيل الطلب"} subtitle={order.id} back testID="order-detail">
      {placed ? (
        <Card tone="soft" style={{ alignItems: "center", gap: 8, marginBottom: 12 }} testID="order-placed">
          <Mascot size={110} motion="dance" interactive={false} />
          <Row><PartyPopper size={20} color={t.orange} /><Txt weight="extra" style={{ fontSize: 18 }}>{tr("شكرًا لك! طلبك بالطريق قريبًا")}</Txt></Row>
          <Txt style={{ color: t.muted, textAlign: "center" }}>{tr("ستصلك إشعارات عند كل مرحلة، ورمز تسليم عند خروج الطلب.")}</Txt>
        </Card>
      ) : null}
      {error ? <Notice text={error} tone="danger" /> : null}
      <Card style={{ gap: 12 }}>
        <Row style={{ justifyContent: "space-between" }}><Badge label={orderLabels[order.status] || order.status} tone={order.status === "delivered" ? "success" : order.status === "cancelled" ? "danger" : "accent"} /><Txt style={{ color: t.muted, fontSize: 12 }}>{new Date(order.createdAt || order.date).toLocaleString("ar-JO")}</Txt></Row>
        <OrderSteps status={order.status} />
        {code ? <View testID="order-delivery-code" style={{ backgroundColor: t.primarySoft, borderRadius: 16, padding: 12 }}><Txt weight="bold" style={{ color: t.primary }}>{tr("رمز التسليم")}</Txt><Txt weight="extra" style={{ fontSize: 28, letterSpacing: 8, textAlign: "center", color: t.primary }}>{code}</Txt></View> : null}
        <Row wrap>
          {order.status !== "cancelled" && order.status !== "delivered" ? <Button title={tr("تتبع")} icon={<MapPin size={16} color={t.onAccent} />} onPress={() => router.push(`/tracking/${order.id}`)} style={{ flex: 1 }} /> : null}
          <Button title={tr("الفاتورة")} secondary icon={<FileText size={16} color={t.ink} />} onPress={() => router.push(`/invoice/${order.id}`)} style={{ flex: 1 }} />
          <Button title={tr("الدعم")} secondary icon={<Headset size={16} color={t.ink} />} onPress={() => router.push({ pathname: "/support", params: { orderId: order.id } })} style={{ flex: 1 }} />
        </Row>
      </Card>
      <Card style={{ marginTop: 12 }}>
        {order.items.map((i) => <KeyValue key={i.productId} label={`${i.name} × ${i.quantity}`} value={money.format(i.price * i.quantity, order.currency)} />)}
        <View style={{ height: 1, backgroundColor: t.line, marginVertical: 6 }} />
        <KeyValue label="المجموع الفرعي" value={money.format(order.subtotal, order.currency)} />
        {order.discount ? <KeyValue label="الخصم" value={`- ${money.format(order.discount, order.currency)}`} /> : null}
        <KeyValue label="التوصيل" value={money.format(order.shipping, order.currency)} />
        {extras.gift?.fee ? <KeyValue label="تغليف الهدية" value={money.format(extras.gift.fee, order.currency)} /> : null}
        <KeyValue label="الإجمالي" value={money.format(order.total, order.currency)} strong />
        <KeyValue label="الدفع" value={`${tr(PAY[order.paymentMethod] || order.paymentMethod)}${extras.payment?.last4 ? ` •••• ${extras.payment.last4}` : ""}`} />
        {extras.slot ? <KeyValue label="موعد التوصيل" value={`${extras.slot.label} · ${extras.slot.date}`} /> : null}
        {extras.deliveryNotes ? <KeyValue label="ملاحظات" value={extras.deliveryNotes} /> : null}
        {extras.gift?.message ? <KeyValue label="رسالة الهدية" value={extras.gift.message} /> : null}
      </Card>
      <Row wrap style={{ marginTop: 12 }}>
        <Button title={tr("إعادة الطلب")} secondary icon={<RotateCcw size={16} color={t.ink} />} onPress={() => { reorder(order); router.push("/cart"); }} style={{ flex: 1 }} />
        {order.status === "delivered" ? <Button title={tr("إرجاع منتجات")} secondary icon={<Undo2 size={16} color={t.ink} />} onPress={() => router.push({ pathname: "/returns", params: { orderId: order.id } })} style={{ flex: 1 }} /> : null}
        {["pending", "confirmed"].includes(order.status) ? <Button title={tr("إلغاء الطلب")} tone="danger" testID="cancel-order" busy={busy} onPress={() => void cancel()} style={{ flex: 1 }} /> : null}
      </Row>
      {order.status === "delivered" ? (
        <Card style={{ marginTop: 12, gap: 8 }} testID="rate-order">
          {extras.rating ? <><Txt weight="bold">{tr("تقييمك")}</Txt>{stars(extras.rating.rating, () => {}, "rated")}{extras.rating.comment ? <Txt style={{ color: t.muted }}>{extras.rating.comment}</Txt> : null}</> : <>
            <Txt weight="bold">{tr("كيف كانت تجربتك؟")}</Txt>
            {stars(rating, setRating, "order-star")}
            <Txt style={{ color: t.muted, fontSize: 13 }}>{tr("تقييم السائق")}</Txt>
            {stars(driverRating, setDriverRating, "driver-star")}
            <Field label="تعليق (اختياري)" value={comment} onChangeText={setComment} testID="rating-comment" />
            <Button title={tr("أرسل التقييم")} testID="submit-rating" busy={busy} disabled={!rating} onPress={() => void rate()} />
          </>}
        </Card>
      ) : null}
    </Shell>
  );
}
