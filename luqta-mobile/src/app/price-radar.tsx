// "رادار الأسعار" (Price Radar) — our price & branches vs imported competitor prices.
import React, { useMemo, useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Search, Store } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { Card, Chip, ErrorBlock, InfoNote, LoadingBlock, SectionHeader } from "../components/design/kit";
import { DemoChip, ProductRow, useMoney } from "../components/smart/Bits";
import { PriceInsight } from "../components/smart/PriceInsight";
import { normalizeSearch } from "../lib/recommendations";
import { useStore } from "../lib/store";
import { useRemote } from "../lib/useRemote";
import type { Comparison } from "../lib/smart";
import { useTheme } from "../lib/theme";

export default function PriceRadar() {
  const { colors: t } = useTheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const { products, settings } = useStore();
  const money = useMoney();
  const [selected, setSelected] = useState<string | undefined>(params.id);
  const [q, setQ] = useState("");
  const product = products.find((p) => p.id === selected);
  const matches = useMemo(() => { const n = normalizeSearch(q); return (n ? products.filter((p) => normalizeSearch(`${p.name} ${p.brand} ${p.tags.join(" ")}`).includes(n)) : products).slice(0, 8); }, [q, products]);
  const { data, loading, error, demo, reload } = useRemote<Comparison>(product ? `/products/${product.id}/compare` : null, {
    demo: () => ({ productId: product!.id, name: product!.name, spread: 0, savingVsHighest: 0, branches: (settings.branches || []).map((b) => ({ id: b.id, name: b.name, stock: null })), rates: [{ source: settings.storeName || "لُقطة", ours: true, price: product!.price, shipping: product!.price >= settings.freeShippingThreshold ? 0 : settings.shippingFee, total: product!.price + (product!.price >= settings.freeShippingThreshold ? 0 : settings.shippingFee), url: null, updatedAt: new Date().toISOString(), inStock: (product!.stock ?? 1) > 0, lowest: true }] }),
  });
  return (
    <Shell title="رادار الأسعار" subtitle="قارن السعر النهائي مع الشحن قبل أن تشتري" side={<DemoChip show={demo && !!product} />}>
      <Card>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}>
          <Search size={22} color={t.purple} />
          <TextInput testID="radar-search" accessibilityLabel="ابحث عن منتج للمقارنة" value={q} onChangeText={setQ} placeholder="ابحث عن منتج للمقارنة" placeholderTextColor={t.mutedSoft} style={{ flex: 1, minWidth: 0, minHeight: 46, color: t.ink, textAlign: "right", fontFamily: "Tajawal_500Medium", fontSize: 16 }} />
        </View>
        {!product || q ? matches.map((p) => <ProductRow key={p.id} product={p} onPress={() => { setSelected(p.id); setQ(""); }} testID={`radar-pick-${p.id}`} />) : null}
      </Card>
      {product ? (
        <>
          <Card style={{ marginTop: 14 }} testID="radar-result">
            <SectionHeader title={product.name} icon={Store} />
            {loading && !data ? <LoadingBlock /> : !data ? <ErrorBlock message={error || "تعذّر التحميل"} onRetry={reload} /> : (
              <View style={{ gap: 8 }}>
                {data.rates.map((r) => (
                  <Pressable key={r.source} disabled={!r.url} accessibilityRole={r.url ? "link" : undefined} onPress={() => r.url && void Linking.openURL(r.url)} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, padding: 12, borderRadius: 16, backgroundColor: r.lowest ? t.successSoft : t.field }}>
                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                      <Txt weight="bold" style={{ color: t.title }}>{r.source}{r.ours ? " (نحن)" : ""}</Txt>
                      <Txt style={{ color: t.muted, fontSize: 12 }}>{money(r.price)} + شحن {money(r.shipping)} · {new Date(r.updatedAt).toLocaleDateString("ar")}</Txt>
                    </View>
                    <Txt weight="extra" style={{ fontSize: 18, color: r.lowest ? t.green : t.title }}>{money(r.total)}</Txt>
                    {r.lowest ? <Chip label="الأقل" tone="success" /> : null}
                  </Pressable>
                ))}
                {data.rates.length > 1 ? <Txt style={{ color: t.ink }}>فرق السعر بين المصادر: {money(data.spread)}{data.savingVsHighest > 0 ? ` — توفيرك معنا ${money(data.savingVsHighest)}` : ""}</Txt> : <InfoNote text="لا توجد أسعار منافسين مستوردة لهذا المنتج بعد؛ تضيفها الإدارة من لوحة التحكم." />}
                {data.branches.length ? <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 6, marginTop: 4 }}>{data.branches.map((b) => <Chip key={b.id} label={`${b.name}: ${b.stock == null ? "متاح" : b.stock > 0 ? `${b.stock} قطعة` : "غير متوفر"}`} tone={b.stock === 0 ? "warn" : "neutral"} />)}</View> : null}
              </View>
            )}
          </Card>
          <PriceInsight product={product} showRadarLink={false} />
        </>
      ) : null}
    </Shell>
  );
}
