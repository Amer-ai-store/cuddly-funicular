import React, { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { CloudDownload, Download, GitCompare, RefreshCw, RotateCcw, Wifi, WifiOff } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { Badge, Button, Card, Chip, EmptyState, Field, Notice, Row, SectionTitle, Txt } from "../../components/ui";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useApi } from "../../lib/useApi";
import { api } from "../../lib/api";
import { saveText } from "../../lib/download";

type Status = { config: { baseUrl: string; apiKeyConfigured: boolean; runnerKeyConfigured: boolean; bridgeId: string; source: string }; lastReceipt: Receipt | null };
type Receipt = { id: string; kind: string; status: "success" | "partial" | "failed"; imported: number; rejected: number; summary: string; retryOf: string | null; createdAt: string; retryable: boolean };
type StockRow = { branchId: string; branch: string; productId: string; name: string; sku: string; quantity: number; version: number };
type PreviewRow = { row: number; id: string; name?: string; status: "new" | "changed" | "unchanged" | "invalid"; changes?: Record<string, [unknown, unknown]>; error?: string };
type Preview = { summary: { total: number; new: number; changed: number; unchanged: number; invalid: number }; rows: PreviewRow[] };
const KIND: Record<string, string> = { export: "تصدير", snapshot: "لقطة", runner: "عمليات", import: "استيراد" };
const TONE = { success: "success", partial: "warning", failed: "danger" } as const;

export default function SyncScreen() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { user } = useSession();
  const status = useApi<Status>("/admin/sync/status", { needsUser: true });
  const branches = useApi<{ branches: { id: string; name: string; city: string }[] }>("/admin/branches", { needsUser: true });
  const [branch, setBranch] = useState("");
  const stock = useApi<{ stock: StockRow[] }>(`/admin/branch-stock${branch ? `?branch=${encodeURIComponent(branch)}` : ""}`, { needsUser: true });
  const receipts = useApi<{ receipts: Receipt[] }>("/admin/sync/receipts", { needsUser: true });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{ preview: Preview; source: "pull" | "csv" } | null>(null);
  const [config, setConfig] = useState({ baseUrl: "", apiKey: "", runnerKey: "", bridgeId: "" });
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" | "warning" } | null>(null);
  const [busy, setBusy] = useState("");
  if (user?.role !== "admin") return <Shell title="المخزون والمزامنة"><EmptyState title="هذه المساحة للمديرين" detail="سجّل الدخول بحساب مدير." action="" /></Shell>;
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key); setMessage(null);
    try { const text = await fn(); if (text) setMessage({ text, tone: "success" }); } catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر تنفيذ العملية", tone: "danger" }); } finally { setBusy(""); receipts.reload(); status.reload(); }
  };
  const receiptText = (r: Receipt) => tr("{id}: {k} — قُبل {i} ورُفض {r}", { id: r.id, k: tr(KIND[r.kind] || r.kind), i: r.imported, r: r.rejected });
  const refreshNow = () => run("refresh", async () => {
    const exported = (await api.post<{ receipt: Receipt }>("/admin/sync/export", {})).receipt;
    const snapshot = (await api.post<{ receipt: Receipt }>("/admin/sync/snapshot", {})).receipt;
    const ops = (await api.post<{ receipt: Receipt }>("/admin/sync/run", {})).receipt;
    const failed = [exported, snapshot, ops].filter((r) => r.status === "failed");
    if (failed.length) throw new Error(failed.map((r) => `${r.id}: ${r.summary}`).join(" · "));
    return [exported, snapshot, ops].map(receiptText).join("\n");
  });
  const pullPreview = () => run("pull", async () => { const r = await api.post<{ preview: Preview }>("/admin/sync/pull", {}); setPreview({ preview: r.preview, source: "pull" }); });
  const csvPreview = () => run("csv", async () => { const r = await api.post<{ preview: Preview }>("/admin/inventory-preview", { csv }); setPreview({ preview: r.preview, source: "csv" }); });
  const apply = () => run("apply", async () => {
    const receipt = preview?.source === "pull" ? (await api.post<{ receipt: Receipt }>("/admin/sync/pull", { apply: true })).receipt : (await api.post<{ receipt: Receipt }>("/admin/sync/import", { source: "ملف CSV", items: csvItems(csv) })).receipt;
    setPreview(null); setCsv(""); stock.reload();
    return receiptText(receipt);
  });
  const saveStock = (row: StockRow) => run(`stock-${row.branchId}-${row.productId}`, async () => {
    await api.put(`/admin/branches/${encodeURIComponent(row.branchId)}/stock`, { items: [{ productId: row.productId, quantity: Number(edits[`${row.branchId}:${row.productId}`]), expectedVersion: row.version }] });
    setEdits((e) => { const next = { ...e }; delete next[`${row.branchId}:${row.productId}`]; return next; }); stock.reload();
    return tr("حُفظت كمية {p}", { p: row.name });
  });
  const download = (r: Receipt) => run(`log-${r.id}`, async () => { await saveText(`${r.id}.csv`, await api.text(`/admin/sync/receipts/${encodeURIComponent(r.id)}/log?format=csv`), "text/csv"); return tr("نُزّل سجل {id}", { id: r.id }); });
  const retry = (r: Receipt) => run(`retry-${r.id}`, async () => receiptText((await api.post<{ receipt: Receipt }>(`/admin/sync/receipts/${encodeURIComponent(r.id)}/retry`, {})).receipt));
  const cfg = status.data?.config;
  const connected = !!cfg?.baseUrl && cfg.apiKeyConfigured;
  return (
    <Shell title="المخزون والمزامنة" subtitle="لوحة القيادة المركزية، الفروع، والاستيراد والتصدير" back testID="sync">
      {message ? <Notice text={message.text} tone={message.tone} /> : null}
      <Card style={{ gap: 8, marginTop: 8 }} testID="sync-status">
        <Row>{connected ? <Wifi size={20} color={t.success} /> : <WifiOff size={20} color={t.danger} />}<Txt weight="bold" style={{ flex: 1 }}>{tr(connected ? "متصل بلوحة القيادة المركزية" : "لوحة القيادة غير معدّة")}</Txt><Badge label={connected ? "متصل" : "غير متصل"} tone={connected ? "success" : "danger"} /></Row>
        {cfg?.baseUrl ? <Txt style={{ color: t.muted, fontSize: 12 }}>{cfg.baseUrl} · {tr("الجسر")}: {cfg.bridgeId || "—"} · {tr("المصدر")}: {cfg.source}</Txt> : null}
        {status.data?.lastReceipt ? <Txt style={{ fontSize: 12 }}>{tr("آخر إيصال")}: {receiptText(status.data.lastReceipt)}</Txt> : null}
        <Row wrap>
          <Button title={tr("استيراد لقطة")} testID="sync-pull" secondary busy={busy === "pull"} icon={<CloudDownload size={16} color={t.ink} />} onPress={() => void pullPreview()} style={{ flex: 1 }} />
          <Button title={tr("تحديث الآن")} testID="sync-refresh" busy={busy === "refresh"} icon={<RefreshCw size={16} color={t.onAccent} />} onPress={() => void refreshNow()} style={{ flex: 1 }} />
          <Button title={tr("عرض الفروقات")} testID="sync-diff" secondary icon={<GitCompare size={16} color={t.ink} />} onPress={() => (csv.trim() ? void csvPreview() : void pullPreview())} style={{ flex: 1 }} />
        </Row>
      </Card>
      {!connected ? (
        <Card style={{ gap: 8, marginTop: 12 }} testID="sync-config">
          <Txt weight="bold">{tr("إعداد الاتصال")}</Txt>
          <Field label="عنوان لوحة القيادة (HTTPS)" value={config.baseUrl} onChangeText={(baseUrl) => setConfig((c) => ({ ...c, baseUrl }))} placeholder="https://amer-ai-command-center.eagerlark64.chatgpt.site" autoCapitalize="none" />
          <Field label="X-AAS-API-Key" value={config.apiKey} onChangeText={(apiKey) => setConfig((c) => ({ ...c, apiKey }))} secureTextEntry autoCapitalize="none" />
          <Field label="X-AAS-Runner-Key" value={config.runnerKey} onChangeText={(runnerKey) => setConfig((c) => ({ ...c, runnerKey }))} secureTextEntry autoCapitalize="none" />
          <Field label="معرّف الجسر" value={config.bridgeId} onChangeText={(bridgeId) => setConfig((c) => ({ ...c, bridgeId }))} autoCapitalize="none" />
          <Txt style={{ color: t.muted, fontSize: 11 }}>{tr("تُحفظ المفاتيح مشفرة على الخادم ولا تُعرض مرة أخرى.")}</Txt>
          <Button title={tr("حفظ الاتصال")} disabled={!config.baseUrl.trim()} onPress={() => void run("config", async () => { await api.put("/admin/sync/config", { baseUrl: config.baseUrl.trim(), apiKey: config.apiKey || undefined, runnerKey: config.runnerKey || undefined, bridgeId: config.bridgeId || undefined }); setConfig({ baseUrl: "", apiKey: "", runnerKey: "", bridgeId: "" }); return "حُفظ الاتصال"; })} />
        </Card>
      ) : null}
      {preview ? (
        <Card style={{ gap: 6, marginTop: 12 }} testID="sync-preview">
          <Txt weight="bold">{tr("الفروقات قبل التطبيق")}</Txt>
          <Row wrap><Badge label={tr("جديد {n}", { n: preview.preview.summary.new })} tone="success" /><Badge label={tr("تغيّر {n}", { n: preview.preview.summary.changed })} tone="warning" /><Badge label={tr("بلا تغيير {n}", { n: preview.preview.summary.unchanged })} tone="muted" /><Badge label={tr("مرفوض {n}", { n: preview.preview.summary.invalid })} tone="danger" /></Row>
          {preview.preview.rows.slice(0, 30).map((r) => <Txt key={r.row} style={{ fontSize: 12, color: r.status === "invalid" ? t.danger : t.ink }}>{r.row}. {r.id} {r.name ? `· ${r.name}` : ""} — {r.error || Object.entries(r.changes || {}).map(([k, [a, b]]) => `${k}: ${String(a ?? "—")} → ${String(b)}`).join("، ") || tr("بلا تغيير")}</Txt>)}
          <Row><Button title={tr("تطبيق المقبول")} testID="sync-apply" busy={busy === "apply"} disabled={!(preview.preview.summary.new + preview.preview.summary.changed)} onPress={() => void apply()} style={{ flex: 1 }} /><Button title={tr("إلغاء")} secondary onPress={() => setPreview(null)} style={{ flex: 1 }} /></Row>
        </Card>
      ) : null}
      <SectionTitle title="مخزون الفروع" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
        <Chip label="كل الفروع" active={!branch} onPress={() => setBranch("")} />
        {(branches.data?.branches || []).map((b) => <Chip key={b.id} testID={`stock-branch-${b.id}`} label={b.name} active={branch === b.id} onPress={() => setBranch(b.id)} />)}
      </ScrollView>
      <Card testID="sku-table" style={{ paddingVertical: 6 }}>
        <Row style={{ paddingVertical: 6, borderBottomWidth: 1, borderColor: t.line }}>{["المنتج", "SKU", "الفرع", "الكمية", "الإصدار"].map((h) => <Txt key={h} weight="bold" style={{ flex: h === "المنتج" ? 2 : 1, fontSize: 11, color: t.muted }}>{tr(h)}</Txt>)}</Row>
        {(stock.data?.stock || []).slice(0, 60).map((row) => {
          const key = `${row.branchId}:${row.productId}`, edited = edits[key];
          return (
            <Row key={key} style={{ paddingVertical: 4, borderBottomWidth: 1, borderColor: t.line }}>
              <Txt style={{ flex: 2, fontSize: 12 }} numberOfLines={1}>{row.name}</Txt>
              <Txt style={{ flex: 1, fontSize: 11, color: t.muted }} numberOfLines={1}>{row.sku}</Txt>
              <Txt style={{ flex: 1, fontSize: 11 }} numberOfLines={1}>{row.branch}</Txt>
              <View style={{ flex: 1 }}><TextInput testID={`qty-${row.branchId}-${row.productId}`} accessibilityLabel={tr("كمية {name}", { name: row.name })} value={edited ?? String(row.quantity)} onChangeText={(v) => setEdits((e) => ({ ...e, [key]: v.replace(/\D/g, "") }))} onSubmitEditing={() => edited !== undefined && void saveStock(row)} keyboardType="number-pad" style={{ minHeight: 32, borderRadius: 8, borderWidth: 1, borderColor: edited !== undefined ? t.primary : t.line, paddingHorizontal: 6, color: t.ink, textAlign: "center" }} /></View>
              <Txt style={{ flex: 1, fontSize: 11, color: t.muted, textAlign: "center" }}>v{row.version}</Txt>
            </Row>
          );
        })}
        {Object.keys(edits).length ? <Button title={tr("حفظ التعديلات")} testID="save-stock" onPress={() => { for (const row of stock.data?.stock || []) if (edits[`${row.branchId}:${row.productId}`] !== undefined) void saveStock(row); }} style={{ marginTop: 8 }} /> : null}
      </Card>
      <SectionTitle title="استيراد ملف CSV" />
      <Card style={{ gap: 8 }} testID="csv-import">
        <TextInput testID="csv-input" accessibilityLabel={tr("محتوى CSV")} value={csv} onChangeText={setCsv} multiline placeholder={tr("id,name,price,stock,category\nmilk,حليب طازج,1.25,40,dairy")} placeholderTextColor={t.muted} style={{ minHeight: 110, borderRadius: 14, borderWidth: 1, borderColor: t.line, padding: 10, color: t.ink, backgroundColor: t.paper, fontFamily: "Tajawal_500Medium", textAlignVertical: "top" }} />
        <Button title={tr("معاينة الفروقات")} testID="csv-preview" secondary busy={busy === "csv"} disabled={!csv.trim()} onPress={() => void csvPreview()} />
      </Card>
      <SectionTitle title="إيصالات المزامنة" />
      <View style={{ gap: 8 }} testID="receipts">
        {(receipts.data?.receipts || []).map((r) => (
          <Card key={r.id} style={{ gap: 6 }} testID={`receipt-${r.id}`}>
            <Row><Txt weight="bold" style={{ flex: 1 }}>{r.id}</Txt><Badge label={tr(KIND[r.kind] || r.kind)} /><Badge label={r.status === "success" ? "ناجح" : r.status === "partial" ? "جزئي" : "فشل"} tone={TONE[r.status]} /></Row>
            <Txt style={{ fontSize: 12 }}>{tr("قُبل {i} · رُفض {r}", { i: r.imported, r: r.rejected })} · {r.summary}</Txt>
            {r.retryOf ? <Txt style={{ fontSize: 11, color: t.muted }}>{tr("إعادة لـ {id}", { id: r.retryOf })}</Txt> : null}
            <Row>
              <Button title={tr("تنزيل السجل")} testID={`download-${r.id}`} secondary busy={busy === `log-${r.id}`} icon={<Download size={14} color={t.ink} />} onPress={() => void download(r)} style={{ flex: 1, minHeight: 38, paddingVertical: 4 }} />
              {r.status !== "success" && r.retryable ? <Button title={tr("إعادة المحاولة")} testID={`retry-${r.id}`} busy={busy === `retry-${r.id}`} icon={<RotateCcw size={14} color={t.onAccent} />} onPress={() => void retry(r)} style={{ flex: 1, minHeight: 38, paddingVertical: 4 }} /> : null}
            </Row>
          </Card>
        ))}
        {receipts.data && !receipts.data.receipts.length ? <Txt style={{ color: t.muted }}>{tr("لا توجد إيصالات بعد.")}</Txt> : null}
      </View>
    </Shell>
  );
}

// Same CSV dialect the server accepts (header row, quoted cells); used to send the previewed rows as items.
function csvItems(text: string) {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some((v) => v.trim())) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries((header || []).map((h, i) => [h.trim(), ["price", "stock", "quantity"].includes(h.trim()) && r[i]?.trim() !== "" ? Number(r[i]) : (r[i] ?? "").trim()])));
}
