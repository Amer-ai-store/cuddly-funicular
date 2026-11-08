import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { Leaf, Refrigerator, Trash } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Badge, Button, Card, Chip, EmptyState, Field, Notice, Row, Stepper, Tabs, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { useRobot } from "../lib/robot";

type Item = { id: string; name: string; quantity: number; expiresOn: string; status: string; daysLeft: number; freshness: "fresh" | "soon" | "expired" | "consumed" | "wasted"; carbonKg: number };
type Stats = { active: number; expiringSoon: number; expired: number; consumed: number; wasted: number; carbonSavedKg: number; wasteRate: number };
const FRESH: Record<string, ["success" | "warning" | "danger" | "muted", string]> = { fresh: ["success", "طازج"], soon: ["warning", "قريب الانتهاء"], expired: ["danger", "منتهي"], consumed: ["muted", "استُهلك"], wasted: ["muted", "هُدر"] };
const CATEGORIES = [["fresh", "خضار وفواكه"], ["dairy", "ألبان"], ["bakery", "مخبوزات"], ["meat", "لحوم"], ["drinks", "مشروبات"], ["other", "أخرى"]] as const;

export default function PantryScreen() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { user } = useSession();
  const robot = useRobot();
  const pantry = useApi<{ items: Item[]; stats: Stats }>("/pantry", { needsUser: true });
  const [tab, setTab] = useState<"active" | "history">("active");
  const [form, setForm] = useState(() => ({ name: "", expiresOn: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10), quantity: 1, category: "fresh" }));
  const [error, setError] = useState("");
  if (!user) return <Shell title="مخزن البيت"><EmptyState title="سجّل الدخول" detail="نتتبع صلاحية مشترياتك تلقائيًا بعد التوصيل." action="تسجيل الدخول" href="/login" /></Shell>;
  const act = async (fn: () => Promise<unknown>) => { setError(""); try { await fn(); pantry.reload(); } catch (e) { setError(e instanceof Error ? e.message : "تعذر التحديث"); } };
  const stats = pantry.data?.stats;
  const items = (pantry.data?.items || []).filter((i) => (tab === "active" ? i.status === "active" : i.status !== "active"));
  return (
    <Shell title="مخزن البيت" subtitle="تابع الصلاحية وقلّل الهدر ووفّر الانبعاثات" robot={stats?.expiringSoon ? tr("عندك {n} منتجات قربت تنتهي!", { n: stats.expiringSoon }) : "مخزنك تمام 🌱"} testID="pantry">
      {error ? <Notice text={error} tone="danger" /> : null}
      <Row style={{ marginTop: 4 }}>
        <Card style={{ flex: 1, alignItems: "center", gap: 2 }} testID="carbon"><Leaf size={22} color={t.success} /><Txt weight="extra" style={{ fontSize: 22, color: t.success }}>{stats?.carbonSavedKg ?? 0}</Txt><Txt style={{ fontSize: 11, color: t.muted, textAlign: "center" }}>{tr("كغ انبعاثات وفّرتها")}</Txt></Card>
        <Card style={{ flex: 1, alignItems: "center", gap: 2 }}><Refrigerator size={22} color={t.warning} /><Txt weight="extra" style={{ fontSize: 22, color: t.warning }}>{stats?.expiringSoon ?? 0}</Txt><Txt style={{ fontSize: 11, color: t.muted, textAlign: "center" }}>{tr("قريبة الانتهاء")}</Txt></Card>
        <Card style={{ flex: 1, alignItems: "center", gap: 2 }}><Trash size={22} color={t.danger} /><Txt weight="extra" style={{ fontSize: 22, color: t.danger }}>{stats?.wasteRate ?? 0}%</Txt><Txt style={{ fontSize: 11, color: t.muted, textAlign: "center" }}>{tr("نسبة الهدر")}</Txt></Card>
      </Row>
      <View style={{ marginTop: 12 }}><Tabs value={tab} onChange={setTab} tabs={[{ id: "active", label: "في المخزن", count: stats?.active }, { id: "history", label: "السجل" }]} /></View>
      <View style={{ gap: 8, marginTop: 12 }}>
        {items.map((i) => (
          <Card key={i.id} testID={`pantry-${i.id}`}>
            <Row>
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={6}><Txt weight="bold">{i.name} × {i.quantity}</Txt><Badge label={FRESH[i.freshness][1]} tone={FRESH[i.freshness][0]} /></Row>
                <Txt style={{ color: t.muted, fontSize: 12 }}>{i.status === "active" ? (i.daysLeft >= 0 ? tr("ينتهي بعد {d} يوم ({e})", { d: i.daysLeft, e: i.expiresOn }) : tr("انتهى منذ {d} يوم", { d: -i.daysLeft })) : i.expiresOn}</Txt>
              </View>
              {i.status === "active" ? <>
                <Button title={tr("استهلكته")} testID={`consume-${i.id}`} onPress={() => void act(async () => { await api.patch(`/pantry/${i.id}`, { status: "consumed" }); robot.react("reward", tr("وفّرت {k} كغ انبعاثات 🌱", { k: Math.round(i.carbonKg * i.quantity * 100) / 100 })); })} style={{ minHeight: 38, paddingVertical: 4, paddingHorizontal: 10 }} />
                <Pressable accessibilityRole="button" accessibilityLabel={tr("هُدر")} testID={`waste-${i.id}`} onPress={() => void act(() => api.patch(`/pantry/${i.id}`, { status: "wasted" }))} style={{ padding: 8 }}><Trash size={17} color={t.danger} /></Pressable>
              </> : null}
            </Row>
          </Card>
        ))}
        {pantry.data && !items.length ? <Txt style={{ color: t.muted }}>{tr(tab === "active" ? "مخزنك فارغ؛ نضيف مشترياتك الطازجة تلقائيًا بعد التوصيل." : "لا يوجد سجل بعد.")}</Txt> : null}
      </View>
      <Card style={{ marginTop: 14, gap: 8 }} testID="pantry-add">
        <Txt weight="bold">{tr("أضف منتجًا يدويًا")}</Txt>
        <Field label="الاسم" testID="pantry-name" value={form.name} onChangeText={(name) => setForm((f) => ({ ...f, name }))} placeholder={tr("لبن، خبز…")} />
        <Field label="تاريخ الانتهاء" testID="pantry-date" value={form.expiresOn} onChangeText={(expiresOn) => setForm((f) => ({ ...f, expiresOn }))} placeholder="YYYY-MM-DD" />
        <Row wrap>{CATEGORIES.map(([id, label]) => <Chip key={id} label={label} active={form.category === id} onPress={() => setForm((f) => ({ ...f, category: id }))} />)}</Row>
        <Row><Txt style={{ flex: 1 }}>{tr("الكمية")}</Txt><Stepper value={form.quantity} onChange={(quantity) => setForm((f) => ({ ...f, quantity }))} min={1} max={99} /></Row>
        <Button title={tr("إضافة للمخزن")} testID="pantry-submit" disabled={!form.name.trim()} onPress={() => void act(async () => { await api.post("/pantry", { name: form.name.trim(), expiresOn: form.expiresOn, quantity: form.quantity, category: form.category }); setForm((f) => ({ ...f, name: "" })); })} />
      </Card>
    </Shell>
  );
}
