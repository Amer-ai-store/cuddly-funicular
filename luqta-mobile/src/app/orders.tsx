import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { FileText, MapPin, Package, RotateCcw, Undo2 } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { OrderSteps } from "../components/OrderSteps";
import { Badge, Button, Card, EmptyState, Row, Tabs, Txt } from "../components/ui";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";
import { orderLabels } from "../lib/commerce-types";

type Return = { id: string; orderId: string; status: string; reason: string; refund: number | null; items: { name: string; quantity: number }[] | null; createdAt: string };
const ACTIVE = ["pending", "confirmed", "preparing", "out_for_delivery"];
const RETURN_LABELS: Record<string, string> = { requested: "قيد المراجعة", approved: "مقبول — رُدّ المبلغ", rejected: "مرفوض" };

export default function Orders() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const { orders, reorder } = useStore();
  const [tab, setTab] = useState<"current" | "previous" | "returns">("current");
  const returns = useApi<{ returns: Return[] }>("/me/returns", { needsUser: true });
  const current = useMemo(() => orders.filter((o) => ACTIVE.includes(o.status)), [orders]);
  const previous = useMemo(() => orders.filter((o) => !ACTIVE.includes(o.status)), [orders]);
  if (!user) return <Shell title="طلباتي"><EmptyState title="سجّل الدخول لعرض طلباتك" detail="طلباتك محفوظة في حسابك على خادم المتجر." action="تسجيل الدخول" href="/login" /></Shell>;
  const list = tab === "current" ? current : previous;
  const date = (value: string) => new Date(value).toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Shell title="طلباتي" subtitle="تابع طلباتك وأعد طلب ما تحب بنقرة" testID="orders">
      <Tabs testID="order-tabs" value={tab} onChange={setTab} tabs={[{ id: "current", label: "الحالية", count: current.length }, { id: "previous", label: "السابقة", count: previous.length }, { id: "returns", label: "المرتجعات", count: returns.data?.returns.length }]} />
      <View style={{ gap: 12, marginTop: 14 }}>
        {tab !== "returns" ? (list.length ? list.map((o) => (
          <Card key={o.id} style={{ gap: 10 }} testID={`order-${o.id}`}>
            <Row style={{ justifyContent: "space-between" }}>
              <Row gap={8}><Package size={18} color={t.primary} /><Txt weight="bold">{o.id}</Txt></Row>
              <Badge label={orderLabels[o.status] || o.status} tone={o.status === "delivered" ? "success" : o.status === "cancelled" ? "danger" : "accent"} />
            </Row>
            <Txt style={{ color: t.muted, fontSize: 12 }}>{date(o.createdAt || o.date)} · {tr("{n} منتجات", { n: o.items.reduce((s, i) => s + i.quantity, 0) })}</Txt>
            <Txt numberOfLines={2} style={{ fontSize: 13 }}>{o.items.map((i) => `${i.name} × ${i.quantity}`).join("، ")}</Txt>
            {ACTIVE.includes(o.status) ? <OrderSteps status={o.status} /> : null}
            <Row style={{ justifyContent: "space-between" }}>
              <Txt weight="extra" style={{ color: t.orange, fontSize: 17 }}>{money.format(o.total, o.currency)}</Txt>
              <Button title={tr("التفاصيل")} secondary onPress={() => router.push(`/order/${o.id}`)} style={{ minHeight: 40, paddingVertical: 6 }} />
            </Row>
            <Row wrap>
              {ACTIVE.includes(o.status) ? <Button title={tr("تتبع")} testID={`track-${o.id}`} icon={<MapPin size={16} color={t.onAccent} />} onPress={() => router.push(`/tracking/${o.id}`)} style={{ flex: 1, minHeight: 44, paddingVertical: 8 }} /> : null}
              {o.status === "delivered" ? <Button title={tr("إرجاع")} testID={`return-${o.id}`} secondary icon={<Undo2 size={16} color={t.ink} />} onPress={() => router.push({ pathname: "/returns", params: { orderId: o.id } })} style={{ flex: 1, minHeight: 44, paddingVertical: 8 }} /> : null}
              <Button title={tr("إعادة الطلب")} testID={`reorder-${o.id}`} secondary icon={<RotateCcw size={16} color={t.ink} />} onPress={() => { reorder(o); router.push("/cart"); }} style={{ flex: 1, minHeight: 44, paddingVertical: 8 }} />
              <Button title={tr("الفاتورة")} testID={`invoice-${o.id}`} secondary icon={<FileText size={16} color={t.ink} />} onPress={() => router.push(`/invoice/${o.id}`)} style={{ flex: 1, minHeight: 44, paddingVertical: 8 }} />
            </Row>
          </Card>
        )) : <EmptyState title={tab === "current" ? "لا توجد طلبات حالية" : "لا توجد طلبات سابقة"} detail="عندما تطلب ستظهر طلباتك هنا مع تتبع مباشر." />) : (
          returns.data?.returns.length ? returns.data.returns.map((r) => (
            <Card key={r.id} style={{ gap: 6 }} testID={`return-card-${r.id}`}>
              <Row style={{ justifyContent: "space-between" }}><Txt weight="bold">{r.orderId}</Txt><Badge label={RETURN_LABELS[r.status] || r.status} tone={r.status === "approved" ? "success" : r.status === "rejected" ? "danger" : "warning"} /></Row>
              <Txt style={{ color: t.muted, fontSize: 13 }}>{r.reason}</Txt>
              {r.items ? <Txt style={{ fontSize: 13 }}>{r.items.map((i) => `${i.name} × ${i.quantity}`).join("، ")}</Txt> : null}
              {r.refund !== null ? <Txt weight="bold" style={{ color: t.success }}>{tr("المبلغ المسترد إلى المحفظة: {m}", { m: money.format(r.refund) })}</Txt> : null}
            </Card>
          )) : <EmptyState title="لا توجد مرتجعات" detail="يمكنك إرجاع منتجات طلب مستلم خلال مهلة الإرجاع." action="" />
        )}
      </View>
    </Shell>
  );
}
