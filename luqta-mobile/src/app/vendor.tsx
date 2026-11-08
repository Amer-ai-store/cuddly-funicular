import React, { useState } from "react";
import { TextInput, View } from "react-native";
import { Store } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Badge, Button, Card, Chip, EmptyState, Field, KeyValue, Notice, Row, SectionTitle, Tabs, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { categoryName, useCategories } from "../lib/catalog";
import { orderLabels } from "../lib/commerce-types";
import type { Product } from "../data/products";

type Summary = { products: number; lowStock: number; orders: number; units: number; sales: number; commission: number; payout: number };
type VendorOrder = { id: string; status: string; createdAt: string; city: string; lines: { name: string; quantity: number; price: number }[]; total: number };

export default function VendorScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const categories = useCategories();
  const mine = useApi<{ vendors: { id: string; name: string; status: string; role: string }[] }>("/vendor/me", { needsUser: true });
  const [picked, setPicked] = useState("");
  const vendorId = picked || mine.data?.vendors[0]?.id || "";
  const summary = useApi<{ vendor: { name: string; status: string }; summary: Summary }>(vendorId ? `/vendor/${vendorId}/summary` : null, { needsUser: true });
  const products = useApi<{ products: Product[] }>(vendorId ? `/vendor/${vendorId}/products` : null, { needsUser: true });
  const orders = useApi<{ orders: VendorOrder[] }>(vendorId ? `/vendor/${vendorId}/orders` : null, { needsUser: true });
  const [tab, setTab] = useState<"products" | "orders">("products");
  const [form, setForm] = useState({ name: "", price: "", stock: "10", category: "bakery", unit: "" });
  const [edits, setEdits] = useState<Record<string, { price?: string; stock?: string }>>({});
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  if (!user) return <Shell title="لوحة التاجر"><EmptyState title="سجّل الدخول" detail="لوحة التاجر لحسابات البائعين." action="تسجيل الدخول" href="/login" /></Shell>;
  if (mine.data && !mine.data.vendors.length) return <Shell title="لوحة التاجر"><EmptyState title="حسابك ليس حساب تاجر بعد" detail="يضيفك مدير المتجر كبائع من «إدارة المشروع ← البائعون» ببريدك الإلكتروني." action="" /></Shell>;
  const run = async (fn: () => Promise<string>) => { setMessage(null); try { setMessage({ text: await fn(), tone: "success" }); products.reload(); summary.reload(); } catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر تنفيذ العملية", tone: "danger" }); } };
  const s = summary.data?.summary;
  return (
    <Shell title="لوحة التاجر" subtitle={summary.data?.vendor.name} robot testID="vendor">
      {mine.data && mine.data.vendors.length > 1 ? <Row wrap>{mine.data.vendors.map((v) => <Chip key={v.id} label={v.name} active={vendorId === v.id} onPress={() => setPicked(v.id)} />)}</Row> : null}
      {message ? <Notice text={message.text} tone={message.tone} /> : null}
      {summary.data?.vendor.status === "suspended" ? <Notice text="حساب التاجر موقوف مؤقتًا؛ تواصل مع إدارة المتجر." tone="danger" /> : null}
      <Card style={{ marginTop: 8 }} testID="vendor-summary">
        <Row><Store size={20} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("ملخص المبيعات")}</Txt></Row>
        <KeyValue label="المبيعات" value={money.format(s?.sales ?? 0)} strong />
        <KeyValue label="عمولة المتجر" value={money.format(s?.commission ?? 0)} />
        <KeyValue label="مستحقاتك" value={money.format(s?.payout ?? 0)} />
        <KeyValue label="الطلبات / القطع" value={`${s?.orders ?? 0} / ${s?.units ?? 0}`} />
        <KeyValue label="المنتجات / منخفضة المخزون" value={`${s?.products ?? 0} / ${s?.lowStock ?? 0}`} />
      </Card>
      <View style={{ marginTop: 12 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: "products", label: "منتجاتي", count: products.data?.products.length }, { id: "orders", label: "طلباتي", count: orders.data?.orders.length }]} /></View>
      {tab === "products" ? (
        <View style={{ gap: 8, marginTop: 12 }}>
          {(products.data?.products || []).map((p) => {
            const e = edits[p.id] || {};
            return (
              <Card key={p.id} style={{ gap: 6 }} testID={`vendor-product-${p.id}`}>
                <Row><Txt weight="bold" style={{ flex: 1 }}>{p.name}</Txt><Badge label={p.active === false ? "مخفي" : "منشور"} tone={p.active === false ? "muted" : "success"} /></Row>
                <Row>
                  <View style={{ flex: 1 }}><Txt style={{ fontSize: 11, color: t.muted }}>{tr("السعر")}</Txt><TextInput accessibilityLabel={tr("السعر {name}", { name: p.name })} value={e.price ?? String(p.basePrice ?? p.price)} onChangeText={(price) => setEdits((x) => ({ ...x, [p.id]: { ...x[p.id], price } }))} keyboardType="decimal-pad" style={{ minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: t.line, paddingHorizontal: 8, color: t.ink }} /></View>
                  <View style={{ flex: 1 }}><Txt style={{ fontSize: 11, color: t.muted }}>{tr("المخزون")}</Txt><TextInput accessibilityLabel={tr("المخزون {name}", { name: p.name })} value={e.stock ?? String(p.baseStock ?? p.stock ?? 0)} onChangeText={(stock) => setEdits((x) => ({ ...x, [p.id]: { ...x[p.id], stock } }))} keyboardType="number-pad" style={{ minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: t.line, paddingHorizontal: 8, color: t.ink }} /></View>
                </Row>
                <Row>
                  <Button title={tr("حفظ")} disabled={!edits[p.id]} onPress={() => void run(async () => { await api.patch(`/vendor/${vendorId}/products/${p.id}`, { ...(e.price !== undefined ? { price: Number(e.price) } : {}), ...(e.stock !== undefined ? { stock: Number(e.stock) } : {}) }); setEdits((x) => { const n = { ...x }; delete n[p.id]; return n; }); return tr("حُفظ {p}", { p: p.name }); })} style={{ flex: 1, minHeight: 38, paddingVertical: 4 }} />
                  <Button title={tr(p.active === false ? "نشر" : "إخفاء")} secondary onPress={() => void run(async () => { await api.patch(`/vendor/${vendorId}/products/${p.id}`, { active: p.active === false }); return "حُدّث المنتج"; })} style={{ flex: 1, minHeight: 38, paddingVertical: 4 }} />
                </Row>
              </Card>
            );
          })}
          <SectionTitle title="منتج جديد" />
          <Card style={{ gap: 8 }} testID="vendor-new-product">
            <Field label="اسم المنتج" testID="vendor-product-name" value={form.name} onChangeText={(name) => setForm((f) => ({ ...f, name }))} />
            <Row style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}><Field label="السعر" testID="vendor-product-price" value={form.price} onChangeText={(price) => setForm((f) => ({ ...f, price }))} keyboardType="decimal-pad" /></View>
              <View style={{ flex: 1 }}><Field label="المخزون" value={form.stock} onChangeText={(stock) => setForm((f) => ({ ...f, stock }))} keyboardType="number-pad" /></View>
            </Row>
            <Field label="الوحدة (اختياري)" value={form.unit} onChangeText={(unit) => setForm((f) => ({ ...f, unit }))} placeholder={tr("4 حبات، 1 كغ…")} />
            <Row wrap>{categories.map((c) => <Chip key={c.id} label={categoryName(c, lang)} active={form.category === c.id} onPress={() => setForm((f) => ({ ...f, category: c.id }))} />)}</Row>
            <Button title={tr("إضافة المنتج")} testID="vendor-add-product" disabled={form.name.trim().length < 2 || !(Number(form.price) > 0)} onPress={() => void run(async () => { await api.post(`/vendor/${vendorId}/products`, { name: form.name.trim(), price: Number(form.price), stock: Number(form.stock) || 0, category: form.category, unit: form.unit.trim() || undefined }); setForm({ name: "", price: "", stock: "10", category: form.category, unit: "" }); return "أُضيف المنتج إلى المتجر"; })} />
          </Card>
        </View>
      ) : (
        <View style={{ gap: 8, marginTop: 12 }}>
          {(orders.data?.orders || []).map((o) => (
            <Card key={o.id} style={{ gap: 4 }}>
              <Row><Txt weight="bold" style={{ flex: 1 }}>{o.id}</Txt><Badge label={orderLabels[o.status] || o.status} tone={o.status === "delivered" ? "success" : "accent"} /></Row>
              <Txt style={{ fontSize: 12, color: t.muted }}>{o.city} · {o.createdAt.slice(0, 10)}</Txt>
              {o.lines.map((l, i) => <Txt key={i} style={{ fontSize: 13 }}>{l.quantity} × {l.name}</Txt>)}
              <Txt weight="bold" style={{ color: t.orange }}>{money.format(o.total)}</Txt>
            </Card>
          ))}
          {orders.data && !orders.data.orders.length ? <Txt style={{ color: t.muted }}>{tr("لا توجد طلبات على منتجاتك بعد.")}</Txt> : null}
        </View>
      )}
    </Shell>
  );
}
