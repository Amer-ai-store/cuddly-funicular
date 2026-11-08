import React, { useCallback, useEffect, useState } from "react";
import { MfaGate, MfaSettingsCard } from "../components/admin/MfaGate";
import { OperationsPanel } from "../components/admin/OperationsPanel";
import { GovernancePanel } from "../components/admin/GovernancePanel";
import { AdminOverview } from "../components/admin/AdminOverview";
import { categoryName, fallbackCategories } from "../lib/catalog";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Shell } from "../components/Shell";
import { Button, Txt, Chip as UiChip, Tabs as UiTabs } from "../components/ui";
import { AdminCard, AdminChoices, AdminField, AdminLoading, AdminNotice, AdminRefresh, numberInput, translateSegment, useAdminAction, useDescribeError } from "../components/admin/AdminUI";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

type Product = { id: string; name: string; price: number; oldPrice?: number; stock: number; category: string; brand?: string; description?: string; subtitle?: string; image?: string; active?: boolean; tags?: string[]; variantOf?: string; variantLabel?: string; basePrice?: number; baseStock?: number };
type User = { id: string; name: string; email: string; role: "admin" | "customer" | "driver" };
type Order = { id: string; status: string; total: number; currency: string; driverId?: string; address?: { name?: string; city?: string; street?: string }; items: { name: string; quantity: number }[] };
type Coupon = { id: string; code: string; type: "percent" | "fixed"; value: number; minSubtotal: number; maxUses?: number; expiresAt?: string; active: boolean; uses?: number };
type ReturnRequest = { id: string; orderId: string; reason: string; status: string; createdAt?: string };
type AgentKey = { id: string; name: string; scopes: string[]; expiresAt?: string; createdAt?: string; revoked?: boolean; revokedAt?: string };
type AgentJob = { id: string; title: string; description: string; type: string; status: string; result?: string; testEvidence?: string; createdAt?: string };
type Ticket = { id: string; userId: string; subject: string; message: string; status: "open" | "resolved"; createdAt: string; updatedAt: string; replies: { id: string; userId: string; name: string; message: string; createdAt: string }[] };
type Settings = { storeName: string; currency: string; country: string; shippingFee: number; freeShippingThreshold: number; returnsDays: number };

const statuses = [
  { value: "pending", label: "جديد" }, { value: "confirmed", label: "مؤكد" }, { value: "preparing", label: "قيد التجهيز" },
  { value: "out_for_delivery", label: "خرج للتوصيل" }, { value: "delivered", label: "تم التسليم" }, { value: "cancelled", label: "ملغي" },
] as const;
const roles = [{ value: "customer", label: "عميل" }, { value: "driver", label: "سائق" }, { value: "admin", label: "مدير" }] as const;
const tabs = [
  { id: "overview", label: "نظرة عامة" }, { id: "products", label: "الأصناف" }, { id: "inventory", label: "المخزون والاستيراد" }, { id: "offers", label: "استيراد العروض" }, { id: "appearance", label: "تصميم المتجر" },
  { id: "orders", label: "الطلبات والتوصيل" }, { id: "returns", label: "المرتجعات" }, { id: "coupons", label: "العروض" },
  { id: "users", label: "المستخدمون والمحفظة" }, { id: "tickets", label: "دعم العملاء" }, { id: "agents", label: "قناة الوكلاء" }, { id: "security", label: "الأمان والتحقق بخطوتين" }, { id: "operations", label: "العمليات الذكية" }, { id: "flags", label: "تشغيل الميزات" }, { id: "settings", label: "الإعدادات" }, { id: "audit", label: "سجل العمليات" },
];
const formatMoney = (value: number, currency = "", locale = "ar") => `${Number(value || 0).toLocaleString(locale, { maximumFractionDigits: 3 })} ${currency}`;
// Amounts and dates follow the chosen language; Arabic keeps the digits it always used.
function useAdminFormat() {
  const { lang } = useI18n();
  const locale = lang === "en" ? "en" : "ar";
  return { money: (value: number, currency = "") => formatMoney(value, currency, locale), date: (value: string) => new Date(value).toLocaleString(locale) };
}
const errorText = (e: unknown) => e instanceof Error ? e.message : "تعذّر تحميل البيانات من الخادم.";

function useAdminData<T>(path: string, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await api.get<T>(path)); }
    catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => {
    let active = true;
    api.get<T>(path).then(value => { if (active) setData(value); })
      .catch(e => { if (active) setError(errorText(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path]);
  return { data, loading, error, reload };
}

// Explanatory text. Its plain-text pieces are translated; data in between ({id}, prices, names) is shown as it is.
function Details({ children }: { children: React.ReactNode }) {
  const { colors: c } = useTheme();
  const { t } = useI18n();
  return <Txt selectable style={{ color: c.muted, fontSize: 13, lineHeight: 23 }}>{React.Children.map(children, (child) => typeof child === "string" ? translateSegment(t, child) : child)}</Txt>;
}

export default function AdminScreen() {
  const { user, hydrated, configured } = useSession();
  if (!hydrated) return <Shell title="لوحة القيادة"><AdminLoading /></Shell>;
  if (!configured) return <Shell title="لوحة القيادة"><AdminCard title="اربط خادم المتجر أولًا"><Details>لوحة الإدارة تقرأ وتكتب في قاعدة بيانات الخادم. أدخل عنوان خادمك واختبر اتصاله.</Details><Button title="إعداد اتصال الخادم" onPress={() => router.push("/connection")} /></AdminCard></Shell>;
  if (!user) return <Shell title="لوحة القيادة"><AdminCard title="تسجيل الدخول مطلوب"><Details>سجّل الدخول بحساب مدير للوصول إلى بيانات المتجر وإدارتها.</Details><Button title="تسجيل الدخول" onPress={() => router.push("/login")} /></AdminCard></Shell>;
  if (user.role !== "admin") return <Shell title="لوحة القيادة"><AdminCard title="هذه المساحة للمديرين"><Details>حسابك لا يملك صلاحية الإدارة. يتحقق الخادم من الدور عند كل عملية.</Details><Button title="العودة إلى حسابي" onPress={() => router.replace("/profile")} secondary /></AdminCard></Shell>;
  return <MfaGate wrap={(node) => <Shell title="لوحة القيادة">{node}</Shell>}><AdminDashboard /></MfaGate>;
}

const moreTabs = tabs.filter((tab) => !["overview", "products", "orders"].includes(tab.id));
function AdminDashboard() {
  const [tab, setTab] = useState<"overview" | "products" | "orders" | "more">("overview");
  const [more, setMore] = useState("inventory");
  return <Shell title="لوحة القيادة" subtitle="المبيعات والطلبات والمخزون والمزامنة في مكان واحد" testID="admin">
    <UiTabs testID="admin-tabs" value={tab} onChange={setTab} tabs={[{ id: "overview", label: "نظرة عامة" }, { id: "products", label: "المنتجات" }, { id: "orders", label: "الطلبات" }, { id: "more", label: "المزيد" }]} />
    <View style={{ gap: 16, paddingVertical: 14 }} key={tab}>
      {tab === "overview" ? <AdminOverview onTab={setTab} /> : tab === "products" ? <ProductsPanel /> : tab === "orders" ? <><OrdersPanel /><ReturnsPanel /></> : <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {moreTabs.map(item => <UiChip key={item.id} label={item.label} active={more === item.id} onPress={() => setMore(item.id)} />)}
        </ScrollView>
        <View style={{ gap: 16 }} key={more}>
          {more === "inventory" ? <><InventoryPanel /><JawafaBridgePanel /></> : more === "offers" ? <OffersPanel /> : more === "appearance" ? <AppearancePanel /> : more === "returns" ? <ReturnsPanel /> : more === "coupons" ? <CouponsPanel /> : more === "users" ? <UsersPanel /> : more === "tickets" ? <TicketsPanel /> : more === "agents" ? <AgentsPanel /> : more === "security" ? <MfaSettingsCard /> : more === "operations" ? <OperationsPanel /> : more === "flags" ? <GovernancePanel /> : more === "settings" ? <SettingsPanel /> : <AuditPanel />}
        </View>
      </>}
    </View>
  </Shell>;
}


const blankProduct = { id: "", name: "", price: "", oldPrice: "", stock: "0", category: "electronics", brand: "", description: "", subtitle: "", image: "", tags: "", active: "yes", variantOf: "", variantLabel: "" };
function ProductsPanel() {
  const { t, lang } = useI18n();
  const { money } = useAdminFormat();
  const categories = fallbackCategories.map((c) => ({ value: c.id, label: categoryName(c, lang) }));
  const resource = useAdminData<{ products: Product[] }>("/admin/products", { products: [] });
  const action = useAdminAction();
  const [form, setForm] = useState(blankProduct);
  const [editing, setEditing] = useState("");
  const [archiveId, setArchiveId] = useState("");
  const change = (key: keyof typeof form) => (value: string) => setForm(f => ({ ...f, [key]: value }));
  const reset = () => { setEditing(""); setForm(blankProduct); };
  const save = () => action.run(async () => {
    if (!form.name.trim() || (!editing && !form.id.trim())) throw new Error("أدخل اسم الصنف ومعرّفه.");
    const payload = { ...form, price: numberInput(form.price, "السعر"), oldPrice: form.oldPrice.trim() ? numberInput(form.oldPrice, "السعر السابق") : null, stock: numberInput(form.stock, "الكمية"), tags: form.tags.split(/[,،]/).map(s => s.trim()).filter(Boolean), active: form.active === "yes" };
    if (editing) await api.patch(`/admin/products/${encodeURIComponent(editing)}`, payload);
    else await api.post("/admin/products", payload);
    reset();
  }, "حُفظ الصنف في قاعدة البيانات.", resource.reload);
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || action.error} message={action.message} />
    <AdminCard title={editing ? "تعديل الصنف" : "إضافة صنف"}>
      {!editing ? <AdminField label="معرّف الصنف أو SKU" value={form.id} onChangeText={change("id")} /> : <Details>{editing}</Details>}
      <AdminField label="اسم الصنف" value={form.name} onChangeText={change("name")} />
      <AdminField label="السعر الحالي" value={form.price} onChangeText={change("price")} numeric /><AdminField label="السعر السابق للعرض — اختياري" value={form.oldPrice} onChangeText={change("oldPrice")} numeric /><AdminField label="الكمية المتاحة" value={form.stock} onChangeText={change("stock")} numeric />
      <AdminField label="معرّف المنتج الأب، إن كان هذا SKU لمقاس أو لون" value={form.variantOf} onChangeText={change("variantOf")} placeholder="مثال: shirt" />
      {form.variantOf ? <AdminField label="اسم المقاس أو اللون" value={form.variantLabel} onChangeText={change("variantLabel")} placeholder="مثال: أزرق / مقاس L" /> : null}
      <AdminChoices label="القسم" value={form.category} choices={categories} onChange={change("category")} />
      <AdminField label="العلامة التجارية" value={form.brand} onChangeText={change("brand")} /><AdminField label="وصف مختصر" value={form.subtitle} onChangeText={change("subtitle")} />
      <AdminField label="وصف الصنف" value={form.description} onChangeText={change("description")} multiline /><AdminField label="رابط صورة HTTPS" value={form.image} onChangeText={change("image")} />
      <AdminField label="وسوم البحث، مفصولة بفاصلة" value={form.tags} onChangeText={change("tags")} />
      <AdminChoices label="ظهور الصنف" value={form.active} choices={[{ value: "yes", label: "منشور" }, { value: "no", label: "مخفي" }]} onChange={change("active")} />
      <Button title={editing ? "حفظ تعديلات الصنف" : "إنشاء الصنف"} onPress={() => void save()} busy={action.busy} />
      {editing ? <Button title="إلغاء التعديل" secondary onPress={reset} /> : null}
    </AdminCard>
    <AdminCard title={t("الأصناف ({n})", { n: resource.data.products.length })}>
      {resource.data.products.map(p => <View key={p.id} style={{ gap: 9, paddingVertical: 13, borderTopWidth: 1, borderTopColor: "#A0A39855" }}><Txt weight="bold">{p.name}</Txt><Details>{p.id} · {p.variantLabel ? `${p.variantLabel} · ` : ""}{money(p.price)} · المخزون {p.stock} · {p.active === false ? "مخفي" : "منشور"}</Details>
        <Button title={t("تعديل {name}", { name: p.name })} secondary onPress={() => { setEditing(p.id); setArchiveId(""); setForm({ id: p.id, name: p.name, price: String(p.basePrice ?? p.price), oldPrice: p.oldPrice == null ? "" : String(p.oldPrice), stock: String(p.baseStock ?? p.stock), category: p.category, brand: p.brand || "", description: p.description || "", subtitle: p.subtitle || "", image: typeof p.image === "string" ? p.image : "", tags: (p.tags || []).join("، "), active: p.active === false ? "no" : "yes", variantOf: p.variantOf || "", variantLabel: p.variantLabel || "" }); }} />
        {archiveId === p.id ? <><Details>سيُخفى هذا الصنف من البيع، مع الاحتفاظ بسجل الطلبات.</Details><Button title={t("تأكيد أرشفة {name}", { name: p.name })} busy={action.busy} onPress={() => void action.run(() => api.delete(`/admin/products/${encodeURIComponent(p.id)}`), "أُرشف الصنف.", resource.reload)} /><Button title="تراجع عن الأرشفة" secondary onPress={() => setArchiveId("")} /></> : <Button title={t("أرشفة {name}", { name: p.name })} secondary onPress={() => setArchiveId(p.id)} />}
      </View>)}
      {!resource.loading && !resource.data.products.length ? <Details>لا توجد أصناف.</Details> : null}
    </AdminCard>
  </>;
}

type InventoryRow = { id?: string; sku?: string; name?: string; price?: number; stock?: number; quantity?: number; category?: string; description?: string };
function parseInventory(text: string): { rows: InventoryRow[]; csv?: string } {
  const content = text.trim();
  if (!content) throw new Error("ألصق بيانات CSV أو JSON أولًا.");
  if (content.startsWith("[") || content.startsWith("{")) {
    let parsed: unknown;
    try { parsed = JSON.parse(content); }
    catch { throw new Error("بيانات JSON غير صالحة. راجع علامات الاقتباس والفواصل والأقواس."); }
    const value = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? ((parsed as { items?: unknown; products?: unknown }).items || (parsed as { products?: unknown }).products) : null;
    if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error("يلزم مصفوفة أصناف من 1 إلى 1000 صف.");
    const rows = value as InventoryRow[];
    for (const row of rows) if (!row || typeof row !== "object" || (!row.id && !row.sku) || !Number.isInteger(row.stock ?? row.quantity) || Number(row.stock ?? row.quantity) < 0) throw new Error("يحتاج كل صنف إلى id أو sku وكمية صحيحة غير سالبة.");
    return { rows };
  }
  const records: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') { if (quoted && content[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if (char === "\n" && !quoted) { row.push(cell.replace(/\r$/, "")); if (row.some(s => s.trim())) records.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("يوجد اقتباس غير مغلق في CSV.");
  row.push(cell.replace(/\r$/, "")); if (row.some(s => s.trim())) records.push(row);
  const headers = records.shift()?.map(s => s.trim().replace(/^\uFEFF/, "")) || [];
  if (!headers.some(h => h === "id" || h === "sku") || !headers.some(h => h === "stock" || h === "quantity")) throw new Error("رأس CSV يجب أن يتضمن id أو sku مع stock أو quantity.");
  const rows = records.map(cells => {
    const item: Record<string, string | number> = {};
    headers.forEach((key, i) => { if (cells[i]?.trim()) item[key] = ["stock", "quantity", "price"].includes(key) ? numberInput(cells[i], key) : cells[i].trim(); });
    return item as InventoryRow;
  });
  if (!rows.length || rows.length > 1000) throw new Error("يلزم 1 إلى 1000 صف استيراد.");
  for (const item of rows) if ((!item.id && !item.sku) || !Number.isInteger(item.stock ?? item.quantity) || Number(item.stock ?? item.quantity) < 0) throw new Error("كل صف يحتاج إلى معرّف وكمية صحيحة غير سالبة.");
  return { rows, csv: content };
}

function InventoryPanel() {
  const { t } = useI18n();
  const { date } = useAdminFormat();
  const describe = useDescribeError();
  const resource = useAdminData<{ connector: { url: string; tokenConfigured: boolean; lastSyncAt?: string; lastResult?: unknown } }>("/admin/inventory/connector", { connector: { url: "", tokenConfigured: false } });
  const undo = useAdminData<{ undo: { id: string; mode: string; count: number; createdAt: string } | null }>("/admin/inventory/undo", { undo: null });
  const action = useAdminAction();
  const [text, setText] = useState(""); const [preview, setPreview] = useState<ReturnType<typeof parseInventory> | null>(null); const [previewError, setPreviewError] = useState("");
  const [mode, setMode] = useState<"replace" | "add">("replace"); const [url, setUrl] = useState<string | null>(null); const [token, setToken] = useState("");
  const [confirmUndo, setConfirmUndo] = useState(false);
  const connectorUrl = url ?? resource.data.connector.url;
  const doPreview = () => { try { setPreview(parseInventory(text)); setPreviewError(""); } catch (e) { setPreview(null); setPreviewError(describe(e)); } };
  return <><AdminNotice error={resource.error || undo.error || action.error || previewError} message={action.message} />
    <AdminCard title="استيراد الأصناف والكميات">
      <Details>ألصق CSV يبدأ بالأعمدة id,name,price,stock,category أو JSON يحتوي مصفوفة items. يراجع الخادم جميع الصفوف قبل حفظ أي تغيير؛ لا يحدث استيراد جزئي.</Details>
      <AdminField label="بيانات CSV أو JSON للاستيراد" value={text} onChangeText={v => { setText(v); setPreview(null); setPreviewError(""); }} multiline placeholder={'id,name,price,stock,category\nnew-item,صنف جديد,25,10,home'} />
      <AdminChoices label="طريقة تحديث الكميات" value={mode} choices={[{ value: "replace", label: "استبدال الكميات" }, { value: "add", label: "إضافة إلى المخزون" }]} onChange={setMode} />
      <Button title="معاينة بيانات الاستيراد" secondary onPress={doPreview} />
      {preview ? <><Txt weight="bold">{t("{n} صف جاهز للمراجعة", { n: preview.rows.length })}</Txt>{preview.rows.slice(0, 8).map((row, i) => <Details key={i}>{row.id || row.sku} · {row.name || "صنف موجود"} · الكمية {row.stock ?? row.quantity}</Details>)}{preview.rows.length > 8 ? <Details>تعرض المعاينة أول 8 صفوف فقط.</Details> : null}
        <Button title={t("تأكيد استيراد {n} صنف", { n: preview.rows.length })} busy={action.busy} onPress={() => void action.run(async () => {
          const result = await api.post<{ imported: number; created: number; updated: number }>("/admin/inventory/import", preview.csv ? { csv: preview.csv, mode } : { items: preview.rows, mode });
          if (!Number.isInteger(result.imported)) throw new Error("استجابة الاستيراد غير متوقعة. راجع سجل العمليات قبل المحاولة مجددًا.");
          setPreview(null); setText(""); setConfirmUndo(false); await undo.reload();
        }, "حُفظت الأصناف والكميات في قاعدة بيانات المتجر.")} /></> : null}
    </AdminCard>
    <AdminCard title="التراجع عن آخر استيراد">
      <Details>يعيد الخادم الأصناف والكميات السابقة فقط إذا لم تتغير منذ الاستيراد ولم تدخل في طلب جديد. الرفض يحمي المبيعات والتعديلات اللاحقة.</Details>
      {undo.data.undo ? <>
        <Details>{t("آخر دفعة: {n} صنف", { n: undo.data.undo.count })} · {date(undo.data.undo.createdAt)}</Details>
        {!confirmUndo ? <Button title="مراجعة التراجع عن آخر استيراد" secondary onPress={() => setConfirmUndo(true)} /> : <>
          <Details>سيُعاد المخزون السابق لهذه الدفعة. هل تريد المتابعة؟</Details>
          <Button title="تأكيد التراجع عن الاستيراد" busy={action.busy} onPress={() => void action.run(async () => {
            await api.post("/admin/inventory/undo", { importId: undo.data.undo!.id });
            setConfirmUndo(false);
          }, "أُعيدت حالة المخزون السابقة وسُجّلت عملية التراجع.", undo.reload)} />
          <Button title="إلغاء التراجع" secondary disabled={action.busy} onPress={() => setConfirmUndo(false)} />
        </>}
      </> : <Details>لا توجد دفعة استيراد قابلة للتراجع.</Details>}
    </AdminCard>
    <AdminCard title="ربط تطبيق المخزون والمزامنة بضغطة">
      <Details>يحتاج الربط إلى عنوان HTTPS يعيد JSON بصيغة items أو products. لا يدّعي التطبيق وجود اتصال قبل نجاح المزامنة. تُمنع عناوين الشبكات الخاصة والروابط المحوّلة لحماية الخادم.</Details>
      <AdminField label="عنوان API لتطبيق المخزون" value={connectorUrl} onChangeText={setUrl} placeholder="https://inventory.example.com/api/products" />
      <AdminField label="رمز اتصال المخزون — اختياري" value={token} onChangeText={setToken} secret />
      <Details>{resource.data.connector.tokenConfigured ? "يوجد رمز محفوظ مشفّر على الخادم؛ اترك الحقل فارغًا للاحتفاظ به." : "لا يوجد رمز اتصال محفوظ."}</Details>
      <Button title="حفظ إعدادات ربط المخزون" busy={action.busy} onPress={() => void action.run(async () => { await api.put("/admin/inventory/connector", { url: connectorUrl.trim(), ...(token ? { token } : {}) }); setUrl(null); setToken(""); }, "حُفظ إعداد الربط.", resource.reload)} />
      <Button title="اختبار الاتصال واستيراد المخزون الآن" busy={action.busy} disabled={!resource.data.connector.url} onPress={() => void action.run(() => api.post("/admin/inventory/sync", {}), "نجح الاتصال وحُفظت بيانات المخزون المستوردة.", async () => { setConfirmUndo(false); await Promise.all([resource.reload(), undo.reload()]); })} />
      <Details>آخر مزامنة: {resource.data.connector.lastSyncAt ? date(resource.data.connector.lastSyncAt) : "لم تُجرَ مزامنة ناجحة بعد"}</Details>
    </AdminCard>
  </>;
}

function OrdersPanel() {
  const { t } = useI18n();
  const { money } = useAdminFormat();
  const resource = useAdminData<{ orders: Order[] }>("/admin/orders", { orders: [] });
  const people = useAdminData<{ users: User[] }>("/admin/users", { users: [] });
  const action = useAdminAction();
  const [selected, setSelected] = useState(""); const [status, setStatus] = useState("pending"); const [driver, setDriver] = useState("");
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || people.error || action.error} message={action.message} />
    {resource.data.orders.map(order => <AdminCard key={order.id} title={order.id}>
      <Details>{order.address?.name} · {order.address?.city} · {order.address?.street}</Details><Details>{statuses.find(s => s.value === order.status)?.label || order.status} · {money(order.total, order.currency)}</Details>
      {order.items.map((item, i) => <Details key={i}>{item.name} × {item.quantity}</Details>)}
      {selected === order.id ? <><AdminChoices label="حالة الطلب" value={status} choices={statuses} onChange={setStatus} /><AdminChoices label="سائق التوصيل" value={driver} choices={[{ value: "", label: "دون سائق" }, ...people.data.users.filter(u => u.role === "driver").map(u => ({ value: u.id, label: u.name }))]} onChange={setDriver} />
        <Details>يسمح الخادم بالانتقالات المتتابعة فقط، ويتحقق من مخزون الطلب وردّ الرصيد عند الإلغاء.</Details><Button title={t("حفظ حالة وتعيين سائق {id}", { id: order.id })} busy={action.busy} onPress={() => void action.run(() => api.patch(`/admin/orders/${encodeURIComponent(order.id)}`, { status, driverId: driver || null }), "حُدّث الطلب وأُرسِل إشعار للعميل.", resource.reload)} />
        <Button title="إغلاق تعديل الطلب" secondary onPress={() => setSelected("")} /></> : <Button title={t("إدارة الطلب {id}", { id: order.id })} secondary onPress={() => { setSelected(order.id); setStatus(order.status); setDriver(order.driverId || ""); }} />}
    </AdminCard>)}
    {!resource.loading && !resource.data.orders.length ? <AdminCard title="لا توجد طلبات"><Details>تظهر هنا الطلبات الفعلية المحفوظة في خادم المتجر.</Details></AdminCard> : null}
  </>;
}

function ReturnsPanel() {
  const { t } = useI18n();
  const resource = useAdminData<{ returns: ReturnRequest[] }>("/admin/returns", { returns: [] }); const action = useAdminAction();
  const [note, setNote] = useState("");
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || action.error} message={action.message} />
    <AdminCard title="ملاحظة قرار الإرجاع"><AdminField label="ملاحظة تُرفق بقرار المرتجع" value={note} onChangeText={setNote} /><Details>اعتماد المرتجع يعيد المخزون ويضيف الرصيد إلى محفظة العميل مرة واحدة. تسوية النقد خارج المتجر لا ينفذها التطبيق.</Details></AdminCard>
    {resource.data.returns.map(item => <AdminCard key={item.id} title={t("مرتجع {id}", { id: item.orderId })}><Details>{item.reason}</Details><Details>الحالة: {returnStatus[item.status] || item.status}</Details>{!["approved", "rejected"].includes(item.status) ? <><Button title={t("اعتماد المرتجع {id}", { id: item.id })} busy={action.busy} onPress={() => void action.run(() => api.patch(`/admin/returns/${encodeURIComponent(item.id)}`, { status: "approved", note }), "اعتُمد المرتجع وأُعيد المخزون والرصيد.", resource.reload)} /><Button title={t("رفض المرتجع {id}", { id: item.id })} secondary busy={action.busy} onPress={() => void action.run(() => api.patch(`/admin/returns/${encodeURIComponent(item.id)}`, { status: "rejected", note }), "حُفظ قرار رفض المرتجع.", resource.reload)} /></> : null}</AdminCard>)}
    {!resource.loading && !resource.data.returns.length ? <Details>لا توجد طلبات إرجاع.</Details> : null}
  </>;
}

const returnStatus: Record<string, string> = { requested: "قيد المراجعة", approved: "معتمد", rejected: "مرفوض" };
const blankCoupon = { code: "", type: "percent" as "percent" | "fixed", value: "", minSubtotal: "0", maxUses: "", expiresAt: "", active: "yes" };
function CouponsPanel() {
  const { t } = useI18n();
  const { money } = useAdminFormat();
  const resource = useAdminData<{ coupons: Coupon[] }>("/admin/coupons", { coupons: [] }); const action = useAdminAction();
  const [form, setForm] = useState(blankCoupon); const [editing, setEditing] = useState("");
  const change = (key: keyof typeof form) => (value: string) => setForm(f => ({ ...f, [key]: value }));
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || action.error} message={action.message} />
    <AdminCard title={editing ? "تعديل العرض" : "إنشاء رمز خصم"}>
      <AdminField label="رمز الخصم" value={form.code} onChangeText={change("code")} /><AdminChoices label="نوع الخصم" value={form.type} choices={[{ value: "percent", label: "نسبة مئوية" }, { value: "fixed", label: "مبلغ ثابت" }]} onChange={v => setForm(f => ({ ...f, type: v }))} />
      <AdminField label="قيمة الخصم" value={form.value} onChangeText={change("value")} numeric /><AdminField label="الحد الأدنى للسلة" value={form.minSubtotal} onChangeText={change("minSubtotal")} numeric />
      <AdminField label="الحد الأقصى للاستخدام — اختياري" value={form.maxUses} onChangeText={change("maxUses")} numeric /><AdminField label="انتهاء الصلاحية YYYY-MM-DD — اختياري" value={form.expiresAt} onChangeText={change("expiresAt")} />
      <AdminChoices label="تفعيل العرض" value={form.active} choices={[{ value: "yes", label: "فعّال" }, { value: "no", label: "متوقف" }]} onChange={change("active")} />
      <Button title={editing ? "حفظ تعديل العرض" : "حفظ رمز الخصم"} busy={action.busy} onPress={() => void action.run(async () => {
        const payload = { code: form.code.trim(), type: form.type, value: numberInput(form.value, "قيمة الخصم"), minSubtotal: numberInput(form.minSubtotal, "الحد الأدنى"), ...(form.maxUses ? { maxUses: numberInput(form.maxUses, "عدد الاستخدامات") } : {}), ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}), active: form.active === "yes" };
        if (editing) await api.patch(`/admin/coupons/${encodeURIComponent(editing)}`, payload); else await api.post("/admin/coupons", payload);
        setEditing(""); setForm(blankCoupon);
      }, "حُفظ العرض في قاعدة البيانات.", resource.reload)} />
      {editing ? <Button title="إلغاء تعديل العرض" secondary onPress={() => { setEditing(""); setForm(blankCoupon); }} /> : null}
    </AdminCard>
    {resource.data.coupons.map(coupon => <AdminCard key={coupon.id} title={coupon.code}><Details>{coupon.type === "percent" ? `${coupon.value}%` : money(coupon.value)} · حد السلة {money(coupon.minSubtotal)} · {coupon.active ? "فعّال" : "متوقف"} · الاستخدام {coupon.uses || 0}</Details>
      <Button title={t("تعديل عرض {code}", { code: coupon.code })} secondary onPress={() => { setEditing(coupon.id); setForm({ code: coupon.code, type: coupon.type, value: String(coupon.value), minSubtotal: String(coupon.minSubtotal || 0), maxUses: coupon.maxUses ? String(coupon.maxUses) : "", expiresAt: coupon.expiresAt?.slice(0, 10) || "", active: coupon.active ? "yes" : "no" }); }} />
      {coupon.active ? <Button title={t("إيقاف عرض {code}", { code: coupon.code })} secondary busy={action.busy} onPress={() => void action.run(() => api.delete(`/admin/coupons/${encodeURIComponent(coupon.id)}`), "أُوقف رمز الخصم.", resource.reload)} /> : null}
    </AdminCard>)}
  </>;
}

function UsersPanel() {
  const { t } = useI18n();
  const resource = useAdminData<{ users: User[] }>("/admin/users", { users: [] }); const action = useAdminAction();
  const [selected, setSelected] = useState(""); const [role, setRole] = useState<User["role"]>("customer"); const [amount, setAmount] = useState(""); const [note, setNote] = useState("");
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || action.error} message={action.message} />
    {resource.data.users.map(user => <AdminCard key={user.id} title={user.name}><Details>{user.email} · {roles.find(r => r.value === user.role)?.label}</Details>
      {selected !== user.id ? <Button title={t("إدارة صلاحيات ومحفظة {name}", { name: user.name })} secondary onPress={() => { setSelected(user.id); setRole(user.role); setAmount(""); setNote(""); }} /> : <>
        <AdminChoices label="دور المستخدم" value={role} choices={roles} onChange={setRole} /><Details>تمنح صلاحية المدير إمكانية تغيير المتجر ومفاتيح الوكلاء. يحمي الخادم حساب المدير الأخير من خفض الصلاحية.</Details>
        <Button title={t("تأكيد تغيير دور {name}", { name: user.name })} busy={action.busy} disabled={role === user.role} onPress={() => void action.run(() => api.patch(`/admin/users/${encodeURIComponent(user.id)}`, { role }), "حُدّثت صلاحية المستخدم.", resource.reload)} />
        <AdminField label={t("تعديل رصيد {name} — موجب أو سالب", { name: user.name })} value={amount} onChangeText={setAmount} numeric /><AdminField label="سبب تعديل الرصيد" value={note} onChangeText={setNote} />
        <Details>هذا قيد داخلي موثّق في المحفظة؛ لا يُحصّل أموالًا من بطاقة أو بنك.</Details><Button title={t("تأكيد تعديل محفظة {name}", { name: user.name })} busy={action.busy} onPress={() => void action.run(() => api.post("/admin/wallet/adjust", { userId: user.id, amount: numberInput(amount, "تعديل الرصيد"), note: note.trim() }), "حُفظ قيد المحفظة.", resource.reload)} />
        <Button title="إغلاق إدارة المستخدم" secondary onPress={() => setSelected("")} />
      </>}
    </AdminCard>)}
  </>;
}

function TicketsPanel() {
  const { t } = useI18n();
  const { date } = useAdminFormat();
  const resource = useAdminData<{ tickets: Ticket[] }>("/admin/tickets", { tickets: [] });
  const action = useAdminAction();
  const [selected, setSelected] = useState("");
  const [reply, setReply] = useState("");
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || action.error} message={action.message} />
    {resource.data.tickets.map(ticket => <AdminCard key={ticket.id} title={ticket.subject}>
      <Details>{ticket.id} · {ticket.status === "resolved" ? "محلولة" : "مفتوحة"} · {date(ticket.createdAt)}</Details>
      <Txt style={{ lineHeight: 25 }}>{ticket.message}</Txt>
      {ticket.replies.map(item => <View key={item.id} style={{ gap: 5, paddingVertical: 10 }}><Txt weight="bold">{item.name}</Txt><Txt style={{ lineHeight: 24 }}>{item.message}</Txt><Details>{date(item.createdAt)}</Details></View>)}
      {selected === ticket.id ? <>
        <AdminField label={t("الرد على تذكرة {subject}", { subject: ticket.subject })} value={reply} onChangeText={setReply} multiline />
        <Button title={t("إرسال الرد على {subject}", { subject: ticket.subject })} busy={action.busy} disabled={!reply.trim()} onPress={() => void action.run(async () => { await api.post(`/admin/tickets/${encodeURIComponent(ticket.id)}/replies`, { message: reply.trim() }); setReply(""); }, "حُفظ الرد وأصبح متاحًا للعميل.", resource.reload)} />
        <Button title="إغلاق محرر الرد" secondary onPress={() => { setSelected(""); setReply(""); }} />
      </> : <Button title={t("كتابة رد على {subject}", { subject: ticket.subject })} secondary onPress={() => { setSelected(ticket.id); setReply(""); }} />}
      <Button title={ticket.status === "resolved" ? t("إعادة فتح تذكرة {subject}", { subject: ticket.subject }) : t("اعتبار تذكرة {subject} محلولة", { subject: ticket.subject })} busy={action.busy} secondary onPress={() => void action.run(() => api.patch(`/admin/tickets/${encodeURIComponent(ticket.id)}`, { status: ticket.status === "resolved" ? "open" : "resolved" }), "حُدّثت حالة تذكرة الدعم.", resource.reload)} />
    </AdminCard>)}
    {!resource.loading && !resource.error && !resource.data.tickets.length ? <AdminCard title="لا توجد تذاكر دعم"><Details>تظهر هنا رسائل الدعم المرسلة من حسابات العملاء.</Details></AdminCard> : null}
  </>;
}

const jobTypes: Record<string, string> = { repair: "إصلاح", development: "تطوير", audit: "فحص" };
const scopes = ["catalog:write", "inventory:write", "orders:write", "settings:write", "jobs:write"];
const scopeLabels: Record<string, string> = { "catalog:write": "تعديل الأصناف", "inventory:write": "تحديث المخزون", "orders:write": "إدارة الطلبات", "settings:write": "إعدادات المتجر", "jobs:write": "مهام التطوير" };
function AgentsPanel() {
  const { colors: c } = useTheme();
  const { t } = useI18n();
  const keys = useAdminData<{ keys: AgentKey[] }>("/admin/agent-keys", { keys: [] }); const jobs = useAdminData<{ jobs: AgentJob[] }>("/admin/agent-jobs", { jobs: [] }); const action = useAdminAction();
  const [name, setName] = useState(""); const [selectedScopes, setSelectedScopes] = useState<string[]>([]); const [expiresAt, setExpiresAt] = useState(""); const [createdToken, setCreatedToken] = useState("");
  const [jobTitle, setJobTitle] = useState(""); const [jobDescription, setJobDescription] = useState(""); const [jobType, setJobType] = useState("repair"); const [revokeId, setRevokeId] = useState("");
  const refresh = async () => { await keys.reload(); await jobs.reload(); };
  return <><AdminRefresh busy={keys.loading || jobs.loading} onPress={() => void refresh()} /><AdminNotice error={keys.error || jobs.error || action.error} message={action.message} />
    <AdminCard title="قناة اتصال الوكلاء بلوحة القيادة">
      <Details>يستعمل الوكيل عنوان الخادم أدناه ورمز Bearer محدود الصلاحيات. يراجع الخادم صلاحية كل إجراء ويحفظ سجلّه. لا يمنح الربط وصولًا عشوائيًا إلى أوامر النظام أو مفاتيح الحسابات.</Details>
      <Txt selectable style={{ textAlign: "left", writingDirection: "ltr", color: c.orange, fontSize: 13 }}>{api.baseUrl()}/api/agent/capabilities</Txt>
      <AdminField label="اسم الوكيل أو التكامل" value={name} onChangeText={setName} />
      <Txt style={{ fontSize: 13 }}>{t("اختر الصلاحيات المسموحة فقط:")}</Txt>
      <View style={{ flexDirection: "row-reverse", gap: 8, flexWrap: "wrap" }}>{scopes.map(scope => <Pressable key={scope} accessibilityRole="checkbox" aria-checked={selectedScopes.includes(scope)} accessibilityLabel={t(scopeLabels[scope])} onPress={() => setSelectedScopes(s => s.includes(scope) ? s.filter(x => x !== scope) : [...s, scope])} style={{ backgroundColor: selectedScopes.includes(scope) ? c.orange : c.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}><Txt style={{ color: selectedScopes.includes(scope) ? "white" : c.ink, fontSize: 13 }}>{t(scopeLabels[scope])}</Txt></Pressable>)}</View>
      <AdminField label="انتهاء صلاحية رمز الوكيل YYYY-MM-DD — اختياري" value={expiresAt} onChangeText={setExpiresAt} />
      <Button title="إنشاء رمز اتصال للوكيل" busy={action.busy} disabled={!name.trim() || !selectedScopes.length} onPress={() => void action.run(async () => {
        setCreatedToken(""); const result = await api.post<{ key: AgentKey; token: string }>("/admin/agent-keys", { name: name.trim(), scopes: selectedScopes, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) });
        if (!result.token) throw new Error("لم يُرجع الخادم رمز اتصال. راجع مفاتيح التكامل.");
        setCreatedToken(result.token); setName(""); setSelectedScopes([]); setExpiresAt("");
      }, "أُنشئ رمز الوكيل. انسخه مرة واحدة إلى إعدادات لوحة القيادة المركزية.", keys.reload)} />
      {createdToken ? <View style={{ gap: 10, padding: 13, borderRadius: 10, backgroundColor: c.background }}><Details>سر يظهر مرة واحدة. لا ترسله في المحادثات ولا تضعه في تطبيق العميل؛ احفظه في خادم الوكيل.</Details><Txt selectable style={{ writingDirection: "ltr", textAlign: "left", fontSize: 12 }}>{createdToken}</Txt><Button title="أخفيت الرمز بعد نسخه" secondary onPress={() => setCreatedToken("")} /></View> : null}
      {keys.data.keys.map(key => <View key={key.id} style={{ gap: 7, paddingVertical: 10 }}><Txt weight="bold">{key.name}</Txt><Details>{key.scopes.map(scope => t(scopeLabels[scope] || scope)).join(" · ")}</Details>
        {key.revoked || key.revokedAt ? <Details>أُلغي الرمز</Details> : revokeId === key.id ? <><Button title={t("تأكيد إلغاء رمز {name}", { name: key.name })} busy={action.busy} onPress={() => void action.run(() => api.delete(`/admin/agent-keys/${encodeURIComponent(key.id)}`), "أُلغي الرمز ولن تُقبل طلباته.", keys.reload)} /><Button title="تراجع عن إلغاء الرمز" secondary onPress={() => setRevokeId("")} /></> : <Button title={t("إلغاء رمز {name}", { name: key.name })} secondary onPress={() => setRevokeId(key.id)} />}
      </View>)}
    </AdminCard>
    <AdminCard title="طلبات الإصلاح والتطوير للوكلاء">
      <Details>تُحفظ هذه الطلبات ليقرأها وكيل لوحة القيادة المركزية عبر API. لا يبدأ تطوير الشيفرة تلقائيًا دون ربط ذلك الوكيل ومستودع GitHub ومشغّل الاختبارات. لا يُعرض الطلب مكتملًا بلا دليل اختبار مسجّل من المنفّذ.</Details>
      <AdminField label="عنوان مهمة التطوير" value={jobTitle} onChangeText={setJobTitle} /><AdminField label="وصف المطلوب ومعيار نجاحه" value={jobDescription} onChangeText={setJobDescription} multiline />
      <AdminChoices label="نوع المهمة" value={jobType} choices={[{ value: "repair", label: "إصلاح" }, { value: "development", label: "تطوير" }, { value: "audit", label: "فحص" }]} onChange={setJobType} />
      <Button title="إرسال الطلب إلى قناة الوكلاء" busy={action.busy} disabled={!jobTitle.trim() || !jobDescription.trim()} onPress={() => void action.run(async () => { await api.post("/admin/agent-jobs", { title: jobTitle.trim(), description: jobDescription.trim(), type: jobType }); setJobTitle(""); setJobDescription(""); }, "حُفظ الطلب في قناة الوكلاء؛ ينتظر منفّذًا متصلًا.", jobs.reload)} />
      {jobs.data.jobs.map(job => <View key={job.id} style={{ gap: 7, paddingVertical: 12 }}><Txt weight="bold">{job.title}</Txt><Details>الحالة: {job.status} · {jobTypes[job.type] || job.type}</Details><Details>{job.description}</Details>{job.result ? <Details>النتيجة: {job.result}</Details> : null}{job.testEvidence ? <Details>دليل الاختبار: {job.testEvidence}</Details> : null}</View>)}
    </AdminCard>
  </>;
}


function OffersPanel() {
  const { t } = useI18n();
  const { money } = useAdminFormat();
  const describe = useDescribeError();
  const resource = useAdminData<{ offers: { id: string; name: string; price: number; oldPrice: number; stock: number }[] }>("/admin/offers", { offers: [] });
  const action = useAdminAction();
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<{ id: string; price: number; oldPrice: number }[] | null>(null);
  const [failure, setFailure] = useState("");
  const review = () => {
    try {
      const list: unknown = JSON.parse(source);
      if (!Array.isArray(list) || !list.length || list.length > 1000 || !list.every(i => i && typeof i.id === "string" && typeof i.price === "number" && typeof i.oldPrice === "number" && i.price > 0 && i.oldPrice >= i.price)) throw Error("قائمة العروض يجب أن تتضمن id وprice وoldPrice.");
      setPreview(list as { id: string; price: number; oldPrice: number }[]); setFailure("");
    } catch(e) { setFailure(describe(e)); setPreview(null); }
  };
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || action.error || failure} message={action.message} />
    <AdminCard title="العروض النشطة"><Details>كل عرض محفوظ في قاعدة المتجر، وليس في القيود المحاسبية الأصلية.</Details>
      {resource.data.offers.map(p => <View key={p.id} style={{ gap: 5, paddingVertical: 9 }}><Txt weight="bold">{p.name}</Txt><Details>{p.id} · قبل: {money(p.oldPrice)} · الآن: {money(p.price)} · المتاح: {p.stock}</Details></View>)}
      {!resource.data.offers.length ? <Details>لا توجد عروض بعد.</Details> : null}
    </AdminCard>
    <AdminCard title="استيراد شاشة العروض">
      <Details>{'ألصق JSON بصيغة [{"id":"SKU_1","price":1.25,"oldPrice":1.75}] ثم افحص العدد قبل الاعتماد.'}</Details>
      <AdminField label="بيانات العروض JSON" value={source} onChangeText={s => { setSource(s); setPreview(null); }} multiline />
      <Button title="معاينة الملف" secondary onPress={review} />
      {preview ? <><Details>{t("تمت المعاينة محليًا: {n} عرضًا. تحقق من الأرقام قبل التنفيذ.", { n: preview.length })}</Details>
      <Button title="اعتماد أسعار العروض في المتجر" busy={action.busy} onPress={() => void action.run(async () => { await api.post("/admin/offers/import", { items: preview, confirm: true }); setPreview(null); setSource(""); }, "حُفظت العروض في قاعدة المتجر.", resource.reload)} /></> : null}
    </AdminCard></>;
}
function AppearancePanel() {
  const resource = useAdminData<{ settings: { storefront?: { accentColor?: string; heroTitle?: string; heroSubtitle?: string; showAssistant?: boolean; instagram?: string; facebook?: string } } | null }>("/admin/settings", { settings: null });
  const action = useAdminAction();
  const design = resource.data.settings?.storefront || {};
  const [edits, setEdits] = useState<{ accentColor?: string; heroTitle?: string; heroSubtitle?: string; showAssistant?: string; instagram?: string; facebook?: string }>({});
  const color = edits.accentColor ?? design.accentColor ?? "#FF6B4A";
  const title = edits.heroTitle ?? design.heroTitle ?? "لُقطات تستحق أن تكون لك";
  const subtitle = edits.heroSubtitle ?? design.heroSubtitle ?? "اكتشف منتجات تُشبه ذوقك";
  const assistant = edits.showAssistant ?? String(design.showAssistant !== false);
  const instagram = edits.instagram ?? design.instagram ?? "";
  const facebook = edits.facebook ?? design.facebook ?? "";
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || action.error} message={action.message} />
    <AdminCard title="إدارة التصميم من نفس التطبيق">
      <AdminField label="لون الهوية بصيغة HEX" value={color} onChangeText={accentColor => setEdits(x => ({...x,accentColor}))} placeholder="#FF6B4A" />
      <AdminField label="عنوان الرئيسية" value={title} onChangeText={heroTitle => setEdits(x => ({...x,heroTitle}))} />
      <AdminField label="وصف الرئيسية" multiline value={subtitle} onChangeText={heroSubtitle => setEdits(x => ({...x,heroSubtitle}))} />
      <AdminChoices label="إظهار قسم المساعد" value={assistant} choices={[{value:"true",label:"إظهار"},{value:"false",label:"إخفاء"}]} onChange={showAssistant => setEdits(x => ({...x,showAssistant}))} />
      <AdminField label="صفحة المتجر على إنستغرام" value={instagram} onChangeText={value => setEdits(x => ({...x,instagram:value}))} placeholder="https://instagram.com/…" />
      <AdminField label="صفحة المتجر على فيسبوك" value={facebook} onChangeText={value => setEdits(x => ({...x,facebook:value}))} placeholder="https://facebook.com/…" />
      <Button title="حفظ تصميم المتجر" busy={action.busy} disabled={!resource.data.settings} onPress={() => void action.run(async () => {
        await api.patch("/admin/settings", { storefront: { accentColor: color.trim(), heroTitle: title.trim(), heroSubtitle: subtitle.trim(), showAssistant: assistant === "true", instagram: instagram.trim(), facebook: facebook.trim() } });
        setEdits({});
      }, "حُفظ تصميم المتجر؛ حدّث الكتالوج لرؤية التغييرات.", resource.reload)} />
      <Details>تعديل ترتيب الشاشات والمكوّنات البرمجية يتطلب تحديث شفرة React Native وإصدار التطبيق بعد اختبارها؛ هذه الشاشة تعدل إعدادات العرض فقط.</Details>
    </AdminCard></>;
}


function JawafaBridgePanel() {
  const { t } = useI18n();
  const action = useAdminAction();
  const [status, setStatus] = useState<{ connected: boolean; database: string; tableCount: number; mode: string; quantityMappingVerified: boolean } | null>(null);
  const [items, setItems] = useState<{ code: string; itemSeq: string; name: string; family: string }[]>([]);
  return <AdminCard title="ربط قاعدة جوافة بالمتجر — قراءة فقط">
    <Details>فحص مباشر من خادم التجارة إلى جسر TrustSoft المحلي. لا يتم نقل كميات للبيع قبل اعتماد المصدر الفعلي.</Details>
    <AdminNotice error={action.error} message={action.message} />
    <Button title="فحص اتصال Jawafa_DB" busy={action.busy} onPress={() => void action.run(async () => {
      const result = await api.get<{ connected: boolean; database: string; tableCount: number; mode: string; quantityMappingVerified: boolean }>("/admin/jawafa/source");
      setStatus(result);
    }, "تحقق اتصال القراءة بقاعدة جوافة.")} />
    {status ? <Details>{status.database} · {status.mode} · {t("عدد الجداول: {n}", { n: status.tableCount })} · الكميات: {status.quantityMappingVerified ? "معتمدة" : "بانتظار المطابقة"}</Details> : null}
    <Button title="معاينة الأصناف والعائلات من جوافة" secondary busy={action.busy} onPress={() => void action.run(async () => {
      const result = await api.get<{ items: { code: string; itemSeq: string; name: string; family: string }[] }>("/admin/jawafa/catalog-preview");
      setItems(result.items);
    }, "تم تحميل أسماء الأصناف للمعاينة فقط.")} />
    {items.map((item, index) => <View key={item.itemSeq + "-" + index} style={{ gap: 4, paddingVertical: 6 }}><Txt weight="bold">{item.name}</Txt><Details>{item.code} · العائلة: {item.family}</Details></View>)}
  </AdminCard>;
}

function SettingsPanel() {
  const resource = useAdminData<{ settings: Settings | null }>("/admin/settings", { settings: null }); const action = useAdminAction();
  const [edits, setEdits] = useState<Partial<Record<keyof Settings, string>>>({});
  const value = resource.data.settings;
  const form = { storeName: edits.storeName ?? value?.storeName ?? "", currency: edits.currency ?? value?.currency ?? "", country: edits.country ?? value?.country ?? "", shippingFee: edits.shippingFee ?? (value ? String(value.shippingFee) : ""), freeShippingThreshold: edits.freeShippingThreshold ?? (value ? String(value.freeShippingThreshold) : ""), returnsDays: edits.returnsDays ?? (value ? String(value.returnsDays) : "") };
  const change = (key: keyof Settings) => (text: string) => setEdits(f => ({ ...f, [key]: text }));
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error || action.error} message={action.message} /><AdminCard title="إعدادات المتجر على الخادم">
    <AdminField label="اسم المتجر" value={form.storeName} onChangeText={change("storeName")} /><AdminField label="رمز العملة ISO مثل JOD أو SAR" value={form.currency} onChangeText={change("currency")} /><AdminField label="بلد التشغيل" value={form.country} onChangeText={change("country")} />
    <AdminField label="رسوم التوصيل" value={form.shippingFee} onChangeText={change("shippingFee")} numeric /><AdminField label="حد الشحن المجاني" value={form.freeShippingThreshold} onChangeText={change("freeShippingThreshold")} numeric /><AdminField label="مهلة الإرجاع بالأيام" value={form.returnsDays} onChangeText={change("returnsDays")} numeric />
    <Button title="حفظ إعدادات المتجر" busy={action.busy} disabled={!resource.data.settings} onPress={() => void action.run(async () => { await api.patch("/admin/settings", { storeName: form.storeName.trim(), currency: form.currency.trim().toUpperCase(), country: form.country.trim(), shippingFee: numberInput(form.shippingFee, "رسوم التوصيل"), freeShippingThreshold: numberInput(form.freeShippingThreshold, "حد الشحن المجاني"), returnsDays: numberInput(form.returnsDays, "مهلة الإرجاع") }); setEdits({}); }, "حُفظت الإعدادات وأصبحت الحسابات التالية تستخدمها.", resource.reload)} />
    <Details>تغيير العملة يغير رمز عملة الطلبات الجديدة ولا يحوّل أسعار الأصناف تلقائيًا. راجع الأسعار قبل البيع الفعلي.</Details>
  </AdminCard></>;
}

function AuditPanel() {
  const { date } = useAdminFormat();
  const resource = useAdminData<{ events: { id: string; actorId: string; action: string; entityId?: string; detail?: unknown; createdAt: string }[] }>("/admin/audit", { events: [] });
  return <><AdminRefresh busy={resource.loading} onPress={() => void resource.reload()} /><AdminNotice error={resource.error} /><AdminCard title="سجل التغييرات على الخادم">
    <Details>يسجل الخادم الجهة المنفّذة وتاريخ تغيير المنتجات والمخزون والطلبات والمفاتيح والصلاحيات.</Details>
    {resource.data.events.map(event => <View key={event.id} style={{ gap: 6, paddingVertical: 12 }}><Txt weight="bold">{event.action}</Txt><Details>{event.actorId} · {event.entityId || ""}</Details><Details>{date(event.createdAt)}</Details>{event.detail ? <Details>{typeof event.detail === "string" ? event.detail : JSON.stringify(event.detail)}</Details> : null}</View>)}
    {!resource.loading && !resource.data.events.length ? <Details>لا توجد عمليات مسجلة بعد.</Details> : null}
  </AdminCard></>;
}
