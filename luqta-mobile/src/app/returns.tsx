import React, { useMemo, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Camera, CheckSquare, Square, Trash } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Button, Card, Chip, EmptyState, Field, Notice, Row, Stepper, Txt } from "../components/ui";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { api } from "../lib/api";
import { pickPhoto } from "../lib/photos";

const REASONS = ["المنتج تالف أو مكسور", "وصلني منتج مختلف", "انتهت صلاحيته", "لم يطابق الوصف", "غيّرت رأيي"];

export default function Returns() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const { orders, refreshOrders, settings } = useStore();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const [orderId, setOrderId] = useState(params.orderId || "");
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ refund: number } | null>(null);
  const delivered = useMemo(() => orders.filter((o) => o.status === "delivered"), [orders]);
  const order = orders.find((o) => o.id === orderId);
  if (!user) return <Shell title="إرجاع منتجات"><EmptyState title="سجّل الدخول أولًا" detail="الإرجاع مرتبط بطلبات حسابك." action="تسجيل الدخول" href="/login" /></Shell>;
  const selected = Object.entries(chosen).filter(([, q]) => q > 0);
  const estimate = order ? selected.reduce((sum, [id, q]) => sum + (order.items.find((i) => i.productId === id)?.price || 0) * q, 0) * (order.subtotal ? 1 - order.discount / order.subtotal : 1) : 0;
  async function attach() {
    setError("");
    try { const image = await pickPhoto({ width: 640, format: "jpeg" }); if (image) setPhoto(image); }
    catch (e) { setError(e instanceof Error && e.message === "permission" ? "اسمح بالوصول إلى الصور لإرفاق صورة." : "تعذر إرفاق الصورة"); }
  }
  async function submit() {
    if (!order) return;
    setBusy(true); setError("");
    try {
      const result = await api.post<{ returnRequest: { refund: number } }>(`/orders/${encodeURIComponent(order.id)}/return-request`, { reason: [reason, details.trim()].filter(Boolean).join(" — "), items: selected.map(([productId, quantity]) => ({ productId, quantity })), photo: photo || undefined });
      setDone({ refund: result.returnRequest.refund }); void refreshOrders();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسجيل الإرجاع"); } finally { setBusy(false); }
  }
  if (done) return (
    <Shell title="تم تسجيل الإرجاع" robot="رح نراجع طلبك بسرعة 💜" testID="return-done">
      <Card style={{ gap: 10 }}>
        <Txt weight="bold">{tr("سنراجع الطلب ونرد المبلغ المتوقع {m} إلى محفظتك بعد الموافقة.", { m: money.format(done.refund) })}</Txt>
        <Button title={tr("عرض المرتجعات")} onPress={() => router.replace("/orders")} />
      </Card>
    </Shell>
  );
  return (
    <Shell title="إرجاع منتجات" subtitle={tr("خلال {d} يومًا من الاستلام، ويُرد المبلغ إلى محفظتك", { d: settings.returnsDays })} back testID="returns">
      {!order ? (
        delivered.length ? <View style={{ gap: 8 }}>
          <Txt weight="bold">{tr("اختر الطلب")}</Txt>
          {delivered.map((o) => <Card key={o.id} onPress={() => setOrderId(o.id)} testID={`pick-order-${o.id}`}><Txt weight="bold">{o.id}</Txt><Txt style={{ color: t.muted, fontSize: 12 }}>{o.items.map((i) => i.name).join("، ")}</Txt></Card>)}
        </View> : <EmptyState title="لا توجد طلبات مستلمة" detail="يمكن إرجاع الطلبات بعد استلامها." />
      ) : (
        <View style={{ gap: 12 }}>
          <Card style={{ gap: 10 }} testID="return-items">
            <Txt weight="bold">{tr("المنتجات والكمية")}</Txt>
            {order.items.map((item) => {
              const on = (chosen[item.productId] || 0) > 0;
              return (
                <View key={item.productId} style={{ gap: 6 }}>
                  <Pressable testID={`return-item-${item.productId}`} accessibilityRole="checkbox" aria-checked={on} onPress={() => setChosen((c) => ({ ...c, [item.productId]: on ? 0 : 1 }))} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, minHeight: 40 }}>
                    {on ? <CheckSquare size={22} color={t.primary} /> : <Square size={22} color={t.muted} />}
                    <Txt style={{ flex: 1 }}>{item.name}</Txt><Txt style={{ color: t.muted, fontSize: 12 }}>{tr("اشتريت {n}", { n: item.quantity })}</Txt>
                  </Pressable>
                  {on ? <Row style={{ justifyContent: "flex-start" }}><Stepper value={chosen[item.productId]} onChange={(q) => setChosen((c) => ({ ...c, [item.productId]: q }))} min={1} max={item.quantity} label={item.name} /></Row> : null}
                </View>
              );
            })}
          </Card>
          <Card style={{ gap: 8 }}>
            <Txt weight="bold">{tr("سبب الإرجاع")}</Txt>
            <Row wrap>{REASONS.map((r) => <Chip key={r} label={r} active={reason === r} onPress={() => setReason(r)} />)}</Row>
            <Field label="تفاصيل" testID="return-details" value={details} onChangeText={setDetails} multiline placeholder={tr("صف المشكلة باختصار")} />
          </Card>
          <Card style={{ gap: 8 }}>
            <Txt weight="bold">{tr("صورة المنتج (اختياري)")}</Txt>
            {photo ? <View><Image source={{ uri: photo }} style={{ width: "100%", height: 180, borderRadius: 16 }} accessibilityLabel={tr("الصورة المرفقة")} /><Pressable accessibilityRole="button" onPress={() => setPhoto(null)} style={{ position: "absolute", top: 8, left: 8, backgroundColor: t.paper, borderRadius: 16, padding: 6 }}><Trash size={16} color={t.danger} /></Pressable></View> : null}
            <Button title={tr(photo ? "تغيير الصورة" : "أرفق صورة")} testID="return-photo" secondary icon={<Camera size={16} color={t.ink} />} onPress={() => void attach()} />
          </Card>
          {selected.length ? <Notice text={tr("المبلغ المتوقع: {m}", { m: money.format(Math.round(estimate * 1000) / 1000) })} tone="success" /> : null}
          {error ? <Notice text={error} tone="danger" /> : null}
          <Button title={tr("أرسل طلب الإرجاع")} testID="submit-return" busy={busy} disabled={!selected.length || !reason} onPress={() => void submit()} />
        </View>
      )}
    </Shell>
  );
}
