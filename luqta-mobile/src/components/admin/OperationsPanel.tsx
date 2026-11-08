// Admin › "العمليات والأدلة" (G18, Master Report v4): import preview → idempotent commit,
// anomaly leads, expiry/waste rescue, stock & branch-transfer suggestions, offer lab with a
// minimum-margin guard, offer-truth audit, backups with restore drill. Every result shows
// what it is (معاينة / توصية / محاكاة) and nothing changes data without an explicit button.
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Txt } from "../ui";
import { AdminCard, AdminField, AdminNotice, numberInput, useAdminAction } from "./AdminUI";
import { api } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/checkout";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { MfaSettingsCard } from "./MfaGate";

type Preview = { canCommit: boolean; beforeHash: string; summary: Record<string, number>; duplicates: { line: number; id: string; kind: string }[]; invalid: { line: number; id?: string; reason: string }[]; unitConflicts: { line: number; id: string }[]; largePriceChanges: { id: string; from: number; to: number; changePercent: number }[] };
type Finding = { code: string; severity: string; entity: string; evidence: Record<string, unknown> };
type ExpiryItem = { productId: string; name: string; stock: number; daysLeft: number; price: number; suggestion: { action: string; percent: number }; suggestedPrice: number | null; saleBlocked: boolean };
type Insights = { lowStock: { productId: string; name: string; stock: number; dailySales: number; suggestedReorder: number }[]; transfers: { productId: string; name: string; from: string; to: string; quantity: number }[] };
type Lab = { newPrice: number; marginPercent: number | null; minMarginPercent: number; allowed: boolean; reason: string; units: { expected: number; low: number; high: number }; profit: { baseline: number | null; expected: number | null }; note: string };
type Backup = { id: string; file: string; bytes: number; sha256: string; createdAt: string; verifiedAt: string | null };
const CODE: Record<string, string> = { order_subtotal_mismatch: "مجموع الأصناف لا يطابق المجموع الفرعي", order_total_mismatch: "إجمالي الطلب لا يطابق مكوّناته", paid_without_gateway_record: "طلب بطاقة مدفوع دون سجل من البوابة", refund_outstanding: "استرداد مستحق لم يُنفّذ", stale_unpaid_card_order: "طلب بطاقة غير مدفوع منذ أكثر من يوم", gateway_paid_order_unpaid: "البوابة تؤكد الدفع والطلب غير مدفوع", coupon_overused: "كوبون تجاوز حد الاستخدام", negative_wallet: "رصيد محفظة سالب", branch_stock_exceeds_total: "مخزون الفروع أكبر من الإجمالي", unverified_was_price: "سعر «قبل الخصم» غير موثّق في السجل", expired_stock_on_shelf: "مخزون منتهي الصلاحية ما زال معروضًا" };
const REASON: Record<string, string> = { missing_id: "بدون معرّف", invalid_stock: "كمية غير صالحة", invalid_price: "سعر غير صالح", new_product_needs_name_and_price: "صنف جديد يحتاج اسمًا وسعرًا" };

function useLoad<T>(path: string, initial: T) {
  const [data, setData] = useState<T>(initial); const [error, setError] = useState("");
  const reload = useCallback(async () => { try { setData(await api.get<T>(path)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "تعذّر التحميل"); } }, [path]);
  useEffect(() => { const id = setTimeout(() => void reload(), 0); return () => clearTimeout(id); }, [reload]);
  return { data, error, reload };
}

export function OperationsPanel() {
  const { t: tr } = useI18n();
  const { colors: c } = useTheme();
  const action = useAdminAction();
  const [csv, setCsv] = useState("id,name,price,stock,barcode,measureUnit,measureSize\n");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batchKey, setBatchKey] = useState(newIdempotencyKey());
  const anomalies = useLoad<{ findings: Finding[]; note: string; checkedAt: string }>("/ops/anomalies", { findings: [], note: "", checkedAt: "" });
  const expiry = useLoad<{ items: ExpiryItem[] }>("/ops/expiry?days=7", { items: [] });
  const insights = useLoad<Insights>("/ops/stock-insights", { lowStock: [], transfers: [] });
  const backups = useLoad<{ backups: Backup[] }>("/ops/backups", { backups: [] });
  const audit = useLoad<{ items: { productId: string; verdict: string }[] }>("/ops/offer-audit", { items: [] });
  const [lab, setLab] = useState({ productId: "", discount: "10", cost: "" });
  const [labResult, setLabResult] = useState<Lab | null>(null);
  const line = { flexDirection: "row-reverse" as const, alignItems: "center" as const, gap: 8, paddingVertical: 6, borderTopWidth: 1, borderColor: c.line };
  return (
    <>
      <AdminNotice error={action.error || anomalies.error} message={action.message} />
      <MfaSettingsCard />
      <AdminCard title="استيراد المخزون بخطوتين: معاينة ثم اعتماد">
        <AdminField label="CSV (id,name,price,stock,barcode,measureUnit,measureSize)" value={csv} onChangeText={(v) => { setCsv(v); setPreview(null); }} multiline />
        <Button title="معاينة دون حفظ" busy={action.busy} onPress={() => void action.run(async () => { setPreview(await api.post<Preview>("/ops/import/preview", { csv })); setBatchKey(newIdempotencyKey()); }, "اكتملت المعاينة")} secondary />
        {preview ? <View style={{ gap: 4 }}>
          <Txt weight="bold" style={{ color: preview.canCommit ? c.green : c.danger }}>{preview.canCommit ? "جاهز للاعتماد" : "لا يمكن الاعتماد قبل تصحيح الملف"}</Txt>
          <Txt style={{ color: c.ink }}>جديد {preview.summary.create} · تحديث {preview.summary.update} · بدون تغيير {preview.summary.unchanged} · مكرر {preview.summary.duplicates} · غير صالح {preview.summary.invalid} · تعارض وحدات {preview.summary.unitConflicts}</Txt>
          {preview.duplicates.map((d) => <Txt key={`d${d.line}`} style={{ color: c.danger, fontSize: 13 }}>سطر {d.line}: {d.id} مكرر ({d.kind === "id" ? "المعرّف" : "الباركود"})</Txt>)}
          {preview.invalid.map((d) => <Txt key={`i${d.line}`} style={{ color: c.danger, fontSize: 13 }}>سطر {d.line}: {REASON[d.reason] || d.reason}</Txt>)}
          {preview.largePriceChanges.map((p) => <Txt key={`p${p.id}`} style={{ color: c.orange, fontSize: 13 }}>تنبيه: سعر {p.id} يتغير {p.changePercent}% ({p.from} ← {p.to})</Txt>)}
          {preview.canCommit ? <Button title="اعتماد الدفعة" busy={action.busy} onPress={() => void action.run(() => api.post("/ops/import/commit", { csv, idempotencyKey: batchKey, expectedBeforeHash: preview.beforeHash }), "اعتُمدت الدفعة (يمكن التراجع من تبويب المخزون)", async () => { setPreview(null); await insights.reload(); })} /> : null}
        </View> : null}
      </AdminCard>
      <AdminCard title={tr("كاشف الفروقات ({count})", { count: anomalies.data.findings.length })}>
        <Txt style={{ color: c.muted, fontSize: 13 }}>{anomalies.data.note || "نتائج للتحقق البشري"}</Txt>
        {anomalies.data.findings.slice(0, 30).map((f, i) => <View key={`${f.code}${f.entity}${i}`} style={line}><Txt style={{ color: f.severity === "high" ? c.danger : c.orange, width: 52 }}>{f.severity === "high" ? "مرتفع" : f.severity === "medium" ? "متوسط" : "منخفض"}</Txt><Txt style={{ flex: 1, color: c.ink }}>{CODE[f.code] || f.code} — {f.entity}</Txt></View>)}
        {!anomalies.data.findings.length ? <Txt style={{ color: c.green }}>لا توجد فروقات في آخر فحص.</Txt> : null}
        <Button title="إعادة الفحص" onPress={() => void anomalies.reload()} secondary />
      </AdminCard>
      <AdminCard title="إنقاذ المنتجات قرب انتهاء الصلاحية (توصيات)">
        {expiry.data.items.map((x) => <View key={x.productId} style={line}>
          <Txt style={{ flex: 1, color: c.ink }}>{x.name} · {x.stock} قطعة · {x.daysLeft < 0 ? "منتهي — البيع موقوف" : tr("باقي {days} يوم", { days: x.daysLeft })}</Txt>
          {x.suggestion.action === "markdown" ? <Button title={tr("خصم {percent}% ← {price}", { percent: x.suggestion.percent ?? 0, price: x.suggestedPrice ?? "" })} busy={action.busy} onPress={() => void action.run(() => api.post("/ops/expiry/apply", { productId: x.productId, percent: x.suggestion.percent, confirm: true }), "طُبّق التخفيض", expiry.reload)} secondary /> : null}
        </View>)}
        {!expiry.data.items.length ? <Txt style={{ color: c.muted }}>لا أصناف تنتهي خلال 7 أيام (أضف تاريخ الصلاحية expiresAt للأصناف).</Txt> : null}
      </AdminCard>
      <AdminCard title="المخزون المنخفض والتحويل بين الفروع (توصيات)">
        {insights.data.lowStock.slice(0, 20).map((l) => <View key={l.productId} style={line}><Txt style={{ flex: 1, color: c.ink }}>{l.name}</Txt><Txt style={{ color: c.muted }}>متوفر {l.stock} · بيع يومي {l.dailySales} · اطلب {l.suggestedReorder}</Txt></View>)}
        {insights.data.transfers.map((t, i) => <Txt key={`t${i}`} style={{ color: c.purple }}>حوّل {t.quantity} من «{t.name}» من {t.from} إلى {t.to}</Txt>)}
        {!insights.data.lowStock.length && !insights.data.transfers.length ? <Txt style={{ color: c.muted }}>لا توصيات حاليًا.</Txt> : null}
      </AdminCard>
      <AdminCard title="مختبر العروض (محاكاة لا تُطبّق شيئًا)">
        <AdminField label="معرّف الصنف" value={lab.productId} onChangeText={(v) => setLab({ ...lab, productId: v })} />
        <AdminField label="نسبة الخصم %" value={lab.discount} onChangeText={(v) => setLab({ ...lab, discount: v })} numeric />
        <AdminField label="تكلفة الوحدة (اختياري، تُحفظ للمدير فقط)" value={lab.cost} onChangeText={(v) => setLab({ ...lab, cost: v })} numeric />
        <Button title="شغّل المحاكاة" busy={action.busy} onPress={() => void action.run(async () => { if (lab.cost.trim()) await api.put("/ops/costs", { costs: [{ productId: lab.productId.trim(), cost: numberInput(lab.cost, "التكلفة") }] }); setLabResult(await api.post<Lab>("/ops/offer-lab", { productId: lab.productId.trim(), discountPercent: numberInput(lab.discount, "نسبة الخصم") })); }, "اكتملت المحاكاة")} secondary />
        {labResult ? <View style={{ gap: 4 }}>
          <Txt weight="bold" style={{ color: labResult.allowed ? c.green : c.danger }}>{labResult.allowed ? "ضمن حد الهامش" : labResult.reason === "cost_unknown" ? "أدخل التكلفة لحساب الهامش" : tr("أقل من حد الهامش {percent}%", { percent: labResult.minMarginPercent })}</Txt>
          <Txt style={{ color: c.ink }}>السعر الجديد {labResult.newPrice} · الهامش {labResult.marginPercent ?? "—"}% · مبيعات أسبوعية متوقعة {labResult.units.expected} (بين {labResult.units.low} و{labResult.units.high})</Txt>
          <Txt style={{ color: c.muted, fontSize: 13 }}>الربح: الحالي {labResult.profit.baseline ?? "—"} ← المتوقع {labResult.profit.expected ?? "—"}. {labResult.note}</Txt>
        </View> : null}
      </AdminCard>
      <AdminCard title="مدقق صدق الخصومات">
        {audit.data.items.map((x) => <View key={x.productId} style={line}><Txt style={{ flex: 1, color: c.ink }}>{x.productId}</Txt><Txt style={{ color: x.verdict === "verified" ? c.green : c.danger }}>{x.verdict === "verified" ? "سعر سابق موثّق" : "غير موثّق خلال 30 يومًا"}</Txt></View>)}
        {!audit.data.items.length ? <Txt style={{ color: c.muted }}>لا أصناف تعرض «سعرًا قبل الخصم».</Txt> : null}
      </AdminCard>
      <AdminCard title="النسخ الاحتياطي وتمرين الاستعادة">
        <Button title="إنشاء نسخة احتياطية الآن" busy={action.busy} onPress={() => void action.run(() => api.post("/ops/backups", {}), "أُنشئت النسخة", backups.reload)} secondary />
        {backups.data.backups.map((b) => <View key={b.id} style={line}>
          <Txt style={{ flex: 1, color: c.ink, fontSize: 13 }}>{new Date(b.createdAt).toLocaleString("ar-JO")} · {Math.round(b.bytes / 1024)} ك.ب · {b.sha256.slice(0, 10)}…</Txt>
          {b.verifiedAt ? <Txt style={{ color: c.green }}>استعادة مُختبرة</Txt> : <Button title="تمرين استعادة" busy={action.busy} onPress={() => void action.run(() => api.post(`/ops/backups/${b.id}/drill`, {}), "نجح تمرين الاستعادة", backups.reload)} secondary />}
        </View>)}
      </AdminCard>
    </>
  );
}
