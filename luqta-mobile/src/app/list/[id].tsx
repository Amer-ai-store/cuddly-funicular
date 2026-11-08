import React, { useState } from "react";
import { Pressable, Share, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { CheckSquare, ClipboardPaste, Copy, ShoppingCart, Square, Trash, UserMinus } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { Badge, Button, Card, Chip, EmptyState, Field, Notice, Row, Stepper, Txt } from "../../components/ui";
import { useStore } from "../../lib/store";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useMoney } from "../../lib/money";
import { useApi } from "../../lib/useApi";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";

type Item = { id: string; productId: string | null; title: string; quantity: number; checked: boolean; addedBy: string; product: { id: string; name: string; price: number; stock: number } | null };
type List = { id: string; name: string; kind: string; role: "owner" | "member"; shareCode: string | null; members: { userId: string; name: string; role: string }[]; items: Item[]; estimatedTotal: number };
type Parsed = { line: string; quantity: number; name: string; product: { id: string; name: string; price: number } | null };
type Suggestion = { type: string; id?: string; label: string };

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const store = useStore();
  const resource = useApi<{ list: List }>(id ? `/lists/${encodeURIComponent(id)}` : null, { needsUser: true });
  const [title, setTitle] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<Parsed[] | null>(null);
  const [error, setError] = useState("");
  const list = resource.data?.list;
  const mutate = async (fn: () => Promise<{ list?: List } | unknown>) => {
    setError("");
    try { const r = (await fn()) as { list?: List }; if (r && r.list) resource.setData({ list: { ...list!, ...r.list } }); else resource.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر تحديث القائمة"); }
  };
  if (!user) return <Shell title="القائمة"><EmptyState title="سجّل الدخول" detail="القوائم مرتبطة بحسابك." action="تسجيل الدخول" href="/login" /></Shell>;
  if (!list) return <Shell title="القائمة" back>{resource.error ? <Notice text={resource.error} tone="danger" /> : <Txt style={{ color: t.muted }}>{tr("جارٍ التحميل…")}</Txt>}</Shell>;
  const base = `/lists/${encodeURIComponent(list.id)}`;
  const typing = async (value: string) => {
    setTitle(value);
    if (value.trim().length < 2) { setSuggestions([]); return; }
    try { setSuggestions((await api.get<{ suggestions: Suggestion[] }>(`/search/suggest?q=${encodeURIComponent(value.trim())}`)).suggestions.filter((s) => s.type === "product").slice(0, 4)); } catch { setSuggestions([]); }
  };
  const addItem = (body: { productId?: string; title?: string; quantity?: number }) => mutate(async () => { const r = await api.post(`${base}/items`, body); setTitle(""); setSuggestions([]); return r; });
  const share = async () => mutate(async () => {
    const r = await api.post<{ code: string }>(`${base}/share`, {});
    await Clipboard.setStringAsync(r.code).catch(() => {});
    await Share.share({ message: tr("انضم لقائمتي «{n}» في لُقطة بالرمز: {c}", { n: list.name, c: r.code }) }).catch(() => {});
    return {};
  });
  const parse = async () => { setError(""); try { setParsed((await api.post<{ items: Parsed[] }>("/ai/parse-list", { text: paste })).items); } catch (e) { setError(e instanceof Error ? e.message : "تعذر قراءة النص"); } };
  const importParsed = async () => {
    for (const item of parsed || []) await api.post(`${base}/items`, item.product ? { productId: item.product.id, quantity: item.quantity } : { title: item.name, quantity: item.quantity }).catch(() => {});
    setParsed(null); setPaste(""); resource.reload();
  };
  const unchecked = list.items.filter((i) => !i.checked && i.product);
  return (
    <Shell title={list.name} subtitle={list.kind === "family" ? tr("قائمة عائلية · {n} أفراد", { n: list.members.length }) : tr("قائمة شخصية")} back testID="list-detail">
      {error ? <Notice text={error} tone="danger" /> : null}
      <Card style={{ gap: 4 }} testID="list-items">
        {list.items.map((item) => (
          <Row key={item.id} style={{ minHeight: 52 }}>
            <Pressable testID={`check-${item.id}`} accessibilityRole="checkbox" aria-checked={item.checked} accessibilityLabel={item.title} onPress={() => void mutate(() => api.patch(`${base}/items/${item.id}`, { checked: !item.checked }))} style={{ padding: 4 }}>
              {item.checked ? <CheckSquare size={22} color={t.success} /> : <Square size={22} color={t.muted} />}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" style={{ textDecorationLine: item.checked ? "line-through" : "none", color: item.checked ? t.muted : t.ink }}>{item.title}</Txt>
              <Txt style={{ color: t.muted, fontSize: 11 }}>{item.product ? money.format(item.product.price) : tr("عنصر نصي")} · {tr("أضافه {n}", { n: item.addedBy })}</Txt>
            </View>
            <Stepper value={item.quantity} onChange={(q) => void mutate(() => api.patch(`${base}/items/${item.id}`, { quantity: q }))} min={1} max={99} label={item.title} />
            <Pressable accessibilityRole="button" accessibilityLabel={`${tr("حذف")} ${item.title}`} onPress={() => void mutate(() => api.delete(`${base}/items/${item.id}`))} style={{ padding: 6 }}><Trash size={16} color={t.danger} /></Pressable>
          </Row>
        ))}
        {!list.items.length ? <Txt style={{ color: t.muted }}>{tr("القائمة فارغة — أضف أول عنصر.")}</Txt> : null}
      </Card>
      <Card style={{ marginTop: 12, gap: 8 }}>
        <Field label="أضف عنصرًا" testID="list-item-input" value={title} onChangeText={(v) => void typing(v)} placeholder={tr("حليب، خبز…")} onSubmitEditing={() => title.trim() && void addItem({ title: title.trim() })} />
        <Row wrap>{suggestions.map((s) => <Chip key={s.id} testID={`list-suggest-${s.id}`} label={s.label} onPress={() => void addItem({ productId: s.id })} />)}</Row>
        <Button title={tr("أضف")} testID="list-add" disabled={!title.trim()} onPress={() => void addItem({ title: title.trim() })} secondary />
      </Card>
      <Row style={{ marginTop: 12, justifyContent: "space-between" }}>
        <Txt weight="extra" style={{ fontSize: 17 }}>{tr("التكلفة المتوقعة {m}", { m: money.format(list.estimatedTotal) })}</Txt>
      </Row>
      <Button title={tr("أضف غير المنجز إلى السلة ({n})", { n: unchecked.length })} testID="list-to-cart" icon={<ShoppingCart size={17} color={t.onAccent} />} disabled={!unchecked.length} onPress={() => { store.addManyToCart(Object.fromEntries(unchecked.map((i) => [i.product!.id, i.quantity]))); router.push("/cart"); }} style={{ marginTop: 8 }} />
      <Card style={{ marginTop: 14, gap: 8 }} testID="list-paste">
        <Row><ClipboardPaste size={18} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("الصق قائمة أو نص فاتورة")}</Txt></Row>
        <Field label="النص" testID="paste-input" value={paste} onChangeText={setPaste} multiline placeholder={"2 حليب\nخبز عربي x3\nطماطم ١"} />
        <Button title={tr("اقرأ النص")} testID="paste-parse" secondary disabled={paste.trim().length < 2} onPress={() => void parse()} />
        {parsed ? <>
          {parsed.map((p, i) => <Row key={i}><Badge label={p.product ? "مطابق" : "نصي"} tone={p.product ? "success" : "muted"} /><Txt style={{ flex: 1 }}>{p.quantity} × {p.product?.name || p.name}</Txt></Row>)}
          <Button title={tr("أضف {n} عناصر للقائمة", { n: parsed.length })} testID="paste-import" onPress={() => void importParsed()} />
        </> : null}
      </Card>
      <Card style={{ marginTop: 14, gap: 8 }} testID="list-members">
        <Txt weight="bold">{tr("أفراد القائمة")}</Txt>
        {list.members.map((m) => (
          <Row key={m.userId}><Txt style={{ flex: 1 }}>{m.name}</Txt>{m.role === "owner" ? <Badge label="المالك" /> : null}
            {list.role === "owner" && m.role !== "owner" ? <Pressable accessibilityRole="button" accessibilityLabel={`${tr("إزالة")} ${m.name}`} onPress={() => void mutate(() => api.delete(`${base}/members/${m.userId}`))}><UserMinus size={16} color={t.danger} /></Pressable> : null}
          </Row>
        ))}
        {list.role === "owner" ? (
          <>
            {list.shareCode ? <Row><Txt weight="extra" style={{ letterSpacing: 4, fontSize: 18, flex: 1 }} testID="share-code">{list.shareCode}</Txt><Pressable accessibilityRole="button" accessibilityLabel={tr("نسخ الرمز")} onPress={() => void Clipboard.setStringAsync(list.shareCode!)}><Copy size={18} color={t.primary} /></Pressable></Row> : null}
            <Button title={tr(list.shareCode ? "مشاركة الرمز" : "شارك مع العائلة")} testID="share-list" tone="primary" onPress={() => void share()} />
            {list.shareCode ? <Button title={tr("إيقاف المشاركة")} secondary onPress={() => void mutate(() => api.delete(`${base}/share`))} /> : null}
            <Button title={tr("حذف القائمة")} tone="danger" onPress={() => void mutate(async () => { await api.delete(base); router.replace("/lists"); return {}; })} />
          </>
        ) : <Button title={tr("مغادرة القائمة")} secondary onPress={() => void mutate(async () => { await api.delete(`${base}/members/${user.id}`); router.replace("/lists"); return {}; })} />}
      </Card>
    </Shell>
  );
}
