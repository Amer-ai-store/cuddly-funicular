// Admin › "الحوكمة والتحليلات" (G16): feature kill switches (audited), curated collections,
// stamp-card loyalty, quick commerce settings, order feedback and the conversion funnel.
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Txt } from "../ui";
import { AdminCard, AdminField, AdminNotice, numberInput, useAdminAction } from "./AdminUI";
import { Toggle } from "../design/kit";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme";

type Settings = { flags?: Record<string, boolean>; collections?: { id: string; title: string; subtitle: string | null; productIds: string[]; active: boolean }[]; stampCard?: { enabled: boolean; stamps: number; rewardType: string; rewardValue: number; minSubtotal: number; validDays: number }; express?: { fee: number; maxKm: number; baseMinutes: number; perKmMinutes: number }; deliveryZones?: { name: string; maxKm: number; fee: number }[] };
type Analytics = { totals: Record<string, number>; funnel: { step: string; count: number; rate?: number }[] };
const STEP: Record<string, string> = { view_product: "مشاهدة منتج", add_to_cart: "إضافة للسلة", begin_checkout: "بدء الدفع", order_placed: "طلب مؤكد" };

function useLoad<T>(path: string, initial: T) {
  const [data, setData] = useState<T>(initial); const [error, setError] = useState("");
  const reload = useCallback(async () => { try { setData(await api.get<T>(path)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "تعذّر التحميل"); } }, [path]);
  useEffect(() => { const id = setTimeout(() => void reload(), 0); return () => clearTimeout(id); }, [reload]);
  return { data, error, reload };
}

export function GovernancePanel() {
  const { colors: c } = useTheme();
  const settings = useLoad<{ settings: Settings }>("/admin/settings", { settings: {} });
  const flags = useLoad<{ flags: Record<string, boolean>; labels: Record<string, string> }>("/flags", { flags: {}, labels: {} });
  const analytics = useLoad<Analytics | null>("/admin/analytics?days=14", null);
  const action = useAdminAction();
  const [col, setCol] = useState({ title: "", productIds: "" });
  const sc = settings.data.settings.stampCard;
  const [stampDraft, setStampDraft] = useState<{ stamps: string; rewardValue: string; minSubtotal: string } | null>(null);
  const stamp = stampDraft ?? { stamps: String(sc?.stamps ?? 5), rewardValue: String(sc?.rewardValue ?? 10), minSubtotal: String(sc?.minSubtotal ?? 0) };
  const collections = settings.data.settings.collections || [];
  const line = { flexDirection: "row-reverse" as const, alignItems: "center" as const, gap: 8, paddingVertical: 6, borderTopWidth: 1, borderColor: c.line };
  return (
    <>
      <AdminNotice error={action.error || settings.error || flags.error} message={action.message} />
      <AdminCard title="مفاتيح الميزات (إيقاف فوري، مسجّل في سجل العمليات)">
        {Object.entries(flags.data.flags).map(([k, v]) => (
          <View key={k} style={line}>
            <Txt style={{ flex: 1, color: c.ink }}>{flags.data.labels[k] || k}</Txt>
            <Toggle value={v} label={flags.data.labels[k] || k} onChange={(next) => void action.run(() => api.patch("/admin/settings", { flags: { [k]: next } }), next ? "فُعّلت الميزة" : "أُوقفت الميزة", flags.reload)} />
          </View>
        ))}
      </AdminCard>
      <AdminCard title="قمع التحويل (آخر 14 يومًا، عدّادات مجهولة)">
        {analytics.data ? analytics.data.funnel.map((f) => (
          <View key={f.step} style={line}><Txt style={{ flex: 1, color: c.ink }}>{STEP[f.step] || f.step}</Txt><Txt weight="bold" style={{ color: c.title }}>{f.count}</Txt>{f.rate != null ? <Txt style={{ color: c.muted, width: 70, textAlign: "left" }}>{f.rate}%</Txt> : <View style={{ width: 70 }} />}</View>
        )) : <Txt style={{ color: c.muted }}>جارٍ التحميل…</Txt>}
        {analytics.data ? <Txt style={{ color: c.muted, fontSize: 13 }}>بحث: {analytics.data.totals.search || 0} · فتح أدوات: {analytics.data.totals.open_tool || 0} · مشاركات: {analytics.data.totals.share || 0} · الإيراد: {analytics.data.totals.revenue || 0}</Txt> : null}
      </AdminCard>
      <AdminCard title="المجموعات المنسّقة على الرئيسية">
        {collections.map((x) => (
          <View key={x.id} style={line}>
            <Txt style={{ flex: 1, color: c.ink }}>{x.title} ({x.productIds.length} منتج)</Txt>
            <Button title="حذف" secondary onPress={() => void action.run(() => api.patch("/admin/settings", { collections: collections.filter((y) => y.id !== x.id) }), "حُذفت المجموعة", settings.reload)} />
          </View>
        ))}
        <AdminField label="عنوان المجموعة" value={col.title} onChangeText={(v) => setCol({ ...col, title: v })} placeholder="مثلًا: روتين الصباح" />
        <AdminField label="معرّفات المنتجات (مفصولة بفاصلة)" value={col.productIds} onChangeText={(v) => setCol({ ...col, productIds: v })} />
        <Button title="إضافة المجموعة" busy={action.busy} onPress={() => void action.run(() => api.patch("/admin/settings", { collections: [...collections, { id: `col-${Date.now().toString(36)}`, title: col.title, productIds: col.productIds.split(/[,،]/).map((s) => s.trim()).filter(Boolean) }] }), "أضيفت المجموعة", settings.reload)} />
      </AdminCard>
      <AdminCard title="بطاقة الأختام">
        <AdminField label="عدد الأختام لإكمال البطاقة" numeric value={stamp.stamps} onChangeText={(v) => setStampDraft({ ...stamp, stamps: v })} />
        <AdminField label="قيمة القسيمة (%)" numeric value={stamp.rewardValue} onChangeText={(v) => setStampDraft({ ...stamp, rewardValue: v })} />
        <AdminField label="أقل قيمة طلب للختم" numeric value={stamp.minSubtotal} onChangeText={(v) => setStampDraft({ ...stamp, minSubtotal: v })} />
        <Button title="حفظ" secondary onPress={() => void action.run(() => api.patch("/admin/settings", { stampCard: { enabled: true, stamps: numberInput(stamp.stamps, "الأختام"), rewardType: "percent", rewardValue: numberInput(stamp.rewardValue, "القيمة"), minSubtotal: numberInput(stamp.minSubtotal, "الحد الأدنى"), validDays: 30 } }), "حُفظت بطاقة الأختام", settings.reload)} />
      </AdminCard>
    </>
  );
}
