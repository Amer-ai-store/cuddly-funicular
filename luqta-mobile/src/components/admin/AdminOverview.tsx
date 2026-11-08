import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { BarChart3, Boxes, ChartPie, ClipboardList, PackageSearch, RefreshCw, Store, TrendingUp } from "lucide-react-native";
import { Badge, Button, Card, Chip, KeyValue, Notice, Row, SectionTitle, Txt } from "../ui";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useMoney } from "../../lib/money";
import { useApi } from "../../lib/useApi";
import { api } from "../../lib/api";
import { orderLabels, type CommerceOrder } from "../../lib/commerce-types";

type Kpis = { salesToday: number; salesWeek: number; orders: number; averageOrderValue: number; activeOrders: number; categories: number; vendors: number; lowStock: number; openChats: number; pendingReturns: number; sync: { id: string; status: string; at: string } | null };
type Report = { totals: { revenue: number; orders: number; averageOrderValue: number; itemsSold: number; returnsRate: number; cancelRate: number }; byDay: { date: string; revenue: number; orders: number }[]; topProducts: { productId: string; name: string; quantity: number; revenue: number }[]; ratings: { average: number; count: number; driverAverage: number } };
type Reorder = { productId: string; name: string; stock: number; perDay: number; daysLeft: number | null; suggestedQuantity: number; urgency: "out" | "high" | "medium" | "ok" };
type Slot = { date: string; window: string; label: string; capacity: number; booked: number };

export function AdminOverview({ onTab }: { onTab: (tab: "products" | "orders" | "more") => void }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const kpis = useApi<{ kpis: Kpis }>("/admin/kpis", { needsUser: true });
  const overview = useApi<{ recentOrders: CommerceOrder[] }>("/admin/overview", { needsUser: true });
  const [days, setDays] = useState(7);
  const report = useApi<Report>(`/admin/reports?days=${days}`, { needsUser: true });
  const reorder = useApi<{ suggestions: Reorder[] }>("/admin/reorder", { needsUser: true });
  const slots = useApi<{ slots: Slot[] }>("/admin/slots?days=3", { needsUser: true });
  const [error, setError] = useState("");
  const k = kpis.data?.kpis;
  const card = (label: string, value: string, Icon: typeof TrendingUp, tone: string, testID: string) => (
    <Card style={{ flexGrow: 1, minWidth: 150, width: "47%", gap: 6 }} testID={testID}>
      <View style={{ width: 38, height: 38, borderRadius: 14, backgroundColor: `${tone}22`, alignItems: "center", justifyContent: "center" }}><Icon size={19} color={tone} /></View>
      <Txt style={{ color: t.muted, fontSize: 12 }}>{tr(label)}</Txt>
      <Txt weight="extra" style={{ fontSize: 21 }}>{value}</Txt>
    </Card>
  );
  const max = Math.max(1, ...(report.data?.byDay || []).map((d) => d.revenue));
  const setCapacity = async (slot: Slot, delta: number) => {
    setError("");
    try { await api.put("/admin/slots", { date: slot.date, window: slot.window, capacity: Math.max(slot.booked, slot.capacity + delta) }); slots.reload(); } catch (e) { setError(e instanceof Error ? tr(e.message) : tr("تعذر تعديل السعة")); }
  };
  return (
    <View style={{ gap: 12 }} testID="admin-overview">
      {error ? <Notice text={error} tone="danger" /> : null}
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 }}>
        {card("مبيعات اليوم", money.format(k?.salesToday ?? 0), TrendingUp, t.success, "kpi-sales")}
        {card("الطلبات", [k?.orders ?? 0, tr("{n} نشطة", { n: k?.activeOrders ?? 0 })].join(" · "), ClipboardList, t.primary, "kpi-orders")}
        {card("المزامنة", k?.sync ? `${k.sync.status === "success" ? "✓" : k.sync.status === "partial" ? "◐" : "✕"} ${k.sync.id}` : tr("لم تُشغّل بعد"), RefreshCw, t.orange, "kpi-sync")}
        {card("الأقسام", [k?.categories ?? 0, tr("{n} مخزون منخفض", { n: k?.lowStock ?? 0 })].join(" · "), Boxes, t.warning, "kpi-categories")}
      </View>
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 10 }}>
        {([["المنتجات", PackageSearch, () => onTab("products")], ["الطلبات", ClipboardList, () => onTab("orders")], ["البائعون", Store, () => router.push({ pathname: "/admin/project", params: { tab: "vendors" } })], ["المخزون والمزامنة", RefreshCw, () => router.push("/admin/sync")], ["إدارة المشروع", ChartPie, () => router.push("/admin/project")], ["التقارير", BarChart3, () => setDays(30)]] as const).map(([label, Icon, go]) => (
          <Pressable key={label} testID={`tile-${label}`} accessibilityRole="button" accessibilityLabel={tr(label)} onPress={go} style={{ width: "31%", flexGrow: 1, minHeight: 86, borderRadius: 22, backgroundColor: t.primarySoft, alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Icon size={22} color={t.primary} /><Txt weight="bold" style={{ fontSize: 12, textAlign: "center" }}>{tr(label)}</Txt>
          </Pressable>
        ))}
      </View>
      <SectionTitle title="التقارير" subtitle={tr("آخر {d} يوم", { d: days })} />
      <Row>{[7, 30, 90].map((d) => <Chip key={d} testID={`report-${d}`} label={tr("{d} يوم", { d })} active={days === d} onPress={() => setDays(d)} />)}</Row>
      <Card style={{ gap: 8 }} testID="report">
        <KeyValue label="الإيراد" value={money.format(report.data?.totals.revenue ?? 0)} strong />
        <KeyValue label="متوسط الطلب" value={money.format(report.data?.totals.averageOrderValue ?? 0)} />
        <KeyValue label="القطع المباعة" value={String(report.data?.totals.itemsSold ?? 0)} />
        <KeyValue label="نسبة المرتجعات / الإلغاء" value={`${report.data?.totals.returnsRate ?? 0}% / ${report.data?.totals.cancelRate ?? 0}%`} />
        <KeyValue label="تقييم الطلبات / السائقين" value={`⭐ ${report.data?.ratings.average || "—"} / ${report.data?.ratings.driverAverage || "—"}`} />
        <View style={{ flexDirection: "row-reverse", alignItems: "flex-end", gap: 4, height: 90, marginTop: 6 }}>
          {(report.data?.byDay || []).map((d) => <View key={d.date} accessibilityLabel={`${d.date}: ${d.revenue}`} style={{ flex: 1, height: Math.max(4, (d.revenue / max) * 86), borderRadius: 6, backgroundColor: t.primary }} />)}
        </View>
        {(report.data?.topProducts || []).slice(0, 3).map((p) => <Txt key={p.productId} style={{ fontSize: 12 }}>🏆 {p.name} — {p.quantity} · {money.format(p.revenue)}</Txt>)}
      </Card>
      <SectionTitle title="أحدث الطلبات" action="كل الطلبات" onPress={() => onTab("orders")} />
      <Card testID="recent-orders">
        {(overview.data?.recentOrders || []).slice(0, 6).map((o) => <Row key={o.id} style={{ justifyContent: "space-between", paddingVertical: 6 }}><Txt style={{ fontSize: 13, flex: 1 }}>{o.id}</Txt><Badge label={orderLabels[o.status] || o.status} tone={o.status === "delivered" ? "success" : "accent"} /><Txt weight="bold" style={{ fontSize: 13 }}>{money.format(o.total, o.currency)}</Txt></Row>)}
        {overview.data && !overview.data.recentOrders.length ? <Txt style={{ color: t.muted }}>{tr("لا توجد طلبات بعد.")}</Txt> : null}
      </Card>
      <SectionTitle title="اقتراحات إعادة الطلب" subtitle="حسب سرعة البيع خلال 30 يومًا" />
      <Card testID="reorder">
        {(reorder.data?.suggestions || []).slice(0, 6).map((s) => <Row key={s.productId} style={{ justifyContent: "space-between", paddingVertical: 6 }}><Badge label={s.urgency === "out" ? "نفد" : s.urgency === "high" ? "عاجل" : "قريبًا"} tone={s.urgency === "out" ? "danger" : s.urgency === "high" ? "warning" : "muted"} /><Txt style={{ flex: 1, fontSize: 13 }}>{s.name}</Txt><Txt style={{ fontSize: 12, color: t.muted }}>{tr("المخزون {s} · اطلب {q}", { s: s.stock, q: s.suggestedQuantity })}</Txt></Row>)}
        {reorder.data && !reorder.data.suggestions.length ? <Txt style={{ color: t.muted }}>{tr("المخزون كافٍ لكل الأصناف.")}</Txt> : null}
      </Card>
      <SectionTitle title="سعة مواعيد التوصيل" />
      <Card testID="slot-capacity">
        {(slots.data?.slots || []).map((s) => (
          <Row key={`${s.date}-${s.window}`} style={{ justifyContent: "space-between", paddingVertical: 4 }}>
            <Txt style={{ fontSize: 12, flex: 1 }}>{s.date.slice(5)} · {s.label}</Txt>
            <Txt style={{ fontSize: 12, color: t.muted }}>{tr("محجوز {b} من {c}", { b: s.booked, c: s.capacity })}</Txt>
            <Button title="−" secondary onPress={() => void setCapacity(s, -5)} style={{ minHeight: 32, paddingVertical: 2, paddingHorizontal: 12 }} />
            <Button title="+" testID={`slot-plus-${s.date}-${s.window}`} secondary onPress={() => void setCapacity(s, 5)} style={{ minHeight: 32, paddingVertical: 2, paddingHorizontal: 12 }} />
          </Row>
        ))}
      </Card>
      <Button title={tr("أدوات الإدارة الكاملة")} secondary onPress={() => onTab("more")} />
    </View>
  );
}
