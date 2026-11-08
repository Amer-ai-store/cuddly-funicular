// Price history chart + "best time to buy" + watch-price (target) + radar link.
// Used on the product page and in رادار الأسعار.
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { Bell, BellRing, Radar, TrendingDown, TrendingUp } from "lucide-react-native";
import { Txt } from "../ui";
import { Card, Chip, CTA, SectionHeader, SmallButton } from "../design/kit";
import { LineChart } from "./Charts";
import { useMoney } from "./Bits";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useStore } from "../../lib/store";
import { localPriceStats, type PriceHistory } from "../../lib/smart";
import { useTheme } from "../../lib/theme";
import type { Product } from "../../data/products";

export function PriceInsight({ product, showRadarLink = true }: { product: Product; showRadarLink?: boolean }) {
  const { colors: t } = useTheme();
  const money = useMoney();
  const { configured, user } = useSession();
  const { notify } = useStore();
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const localHistory = useMemo<PriceHistory>(() => {
    const pts = product.oldPrice && product.oldPrice > product.price ? [{ price: product.oldPrice, at: "قبل العرض" }, { price: product.price, at: "الآن" }] : [{ price: product.price, at: "الآن" }];
    return { productId: product.id, days: 30, points: pts, stats: localPriceStats(pts, product.price) };
  }, [product.id, product.price, product.oldPrice]);
  useEffect(() => {
    let active = true;
    if (!configured) return;
    api.get<PriceHistory>(`/products/${product.id}/price-history?days=30`).then((h) => { if (active) setHistory(h); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [product.id, product.price, product.oldPrice, configured]);
  async function watch() {
    const value = Number(target.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) { notify("أدخل سعرًا صحيحًا"); return; }
    if (!configured || !user) { setOpen(false); router.push("/login"); notify("سجّل الدخول لتفعيل تنبيه السعر"); return; }
    setBusy(true);
    try { const r = await api.post<{ reached: boolean }>("/watchlist", { productId: product.id, target: value }); setOpen(false); notify(r.reached ? "السعر عند هدفك الآن!" : "سنخبرك عند وصول السعر لهدفك"); }
    catch (e) { notify(e instanceof Error ? e.message : "تعذّر تفعيل التنبيه"); } finally { setBusy(false); }
  }
  const shown = configured ? history : localHistory;
  const s = shown?.stats;
  return (
    <Card style={{ marginTop: 14 }} testID="price-insight">
      <SectionHeader title="سجل السعر وأفضل وقت للشراء" icon={s?.trend === "up" ? TrendingUp : TrendingDown} />
      {shown && shown.points.length > 1 ? <LineChart values={shown.points.map((p) => p.price)} labels={["قبل 30 يومًا", "اليوم"]} format={(v) => money(v)} /> : null}
      {s ? (
        <View style={{ gap: 6, marginTop: 6 }}>
          <View style={{ flexDirection: "row-reverse", gap: 6, flexWrap: "wrap" }}>
            <Chip label={`الأدنى ${money(s.min)}`} tone="success" />
            <Chip label={`المتوسط ${money(s.avg)}`} tone="neutral" />
            {s.changePct ? <Chip label={`${s.changePct > 0 ? "+" : ""}${s.changePct}% خلال الفترة`} tone={s.changePct < 0 ? "success" : "warn"} /> : null}
          </View>
          <Txt style={{ color: t.ink, lineHeight: 24 }}>{s.advice}</Txt>
        </View>
      ) : failed ? <Txt style={{ color: t.muted }}>تعذّر تحميل سجل السعر.</Txt> : null}
      <View style={{ flexDirection: "row-reverse", gap: 8, marginTop: 10 }}>
        <SmallButton title="تابع السعر" icon={Bell} onPress={() => { setTarget(String(Math.floor(product.price * 0.9 * 100) / 100)); setOpen(true); }} testID="watch-price" />
        {showRadarLink ? <SmallButton title="قارن الأسعار" icon={Radar} tone="purple" onPress={() => router.push({ pathname: "/price-radar", params: { id: product.id } })} testID="open-radar" /> : null}
      </View>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="إغلاق" onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: "rgba(19,0,80,0.35)", justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="none" onPress={() => {}} style={{ backgroundColor: t.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 }}>
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10 }}><BellRing size={26} color={t.orange} /><Txt weight="extra" style={{ fontSize: 20, color: t.title }}>تنبيه عند انخفاض السعر</Txt></View>
            <Txt style={{ color: t.muted }}>السعر الحالي {money(product.price)}. سنرسل لك إشعارًا عندما يصبح السعر أقل من أو يساوي:</Txt>
            <TextInput testID="watch-target" accessibilityLabel="السعر المستهدف" value={target} onChangeText={setTarget} keyboardType="decimal-pad" style={{ minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.field, paddingHorizontal: 14, fontSize: 20, color: t.ink, textAlign: "center", fontFamily: "Tajawal_700Bold" }} />
            <CTA title="تفعيل التنبيه" busy={busy} onPress={() => void watch()} testID="watch-confirm" />
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  );
}
