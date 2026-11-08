// "نبض السوق" (Market Pulse) — real 30-day price movement & category analytics.
import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { TrendingDown, TrendingUp } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { Card, ErrorBlock, InfoNote, LoadingBlock, SectionHeader } from "../components/design/kit";
import { Bars, LineChart } from "../components/smart/Charts";
import { DemoChip, ProductRow, Stat, useMoney } from "../components/smart/Bits";
import { categoryLabel } from "../data/products";
import { useStore } from "../lib/store";
import { useRemote } from "../lib/useRemote";
import { demoPulse, type MarketPulse } from "../lib/smart";
import { useTheme } from "../lib/theme";

export default function MarketPulseScreen() {
  const { colors: t } = useTheme();
  const { products } = useStore();
  const money = useMoney();
  const { data, loading, error, demo, reload } = useRemote<MarketPulse>("/market/pulse", { demo: () => demoPulse(products) });
  const find = (id: string) => products.find((p) => p.id === id);
  return (
    <Shell title="نبض السوق" subtitle="تحليلات الأسعار واتجاهات الأقسام لآخر 30 يومًا" side={<DemoChip show={demo} />}>
      {loading && !data ? <LoadingBlock /> : !data ? <ErrorBlock message={error || "تعذّر تحميل نبض السوق"} onRetry={reload} /> : (
        <View style={{ gap: 14 }} testID="market-pulse">
          <View style={{ flexDirection: "row-reverse", gap: 8 }}>
            <Stat label="منتج نشط" value={String(data.totals.products)} />
            <Stat label="عرض حالي" value={String(data.totals.offers)} tone="good" />
            <Stat label="تغيير سعر (30 يوم)" value={String(data.totals.priceChanges30d)} />
          </View>
          {data.timeline.length > 1 ? (
            <Card>
              <SectionHeader title="متوسط الأسعار المعدّلة يوميًا" />
              <LineChart values={data.timeline.map((d) => d.avg)} labels={[data.timeline[0].day.slice(5), data.timeline[data.timeline.length - 1].day.slice(5)]} format={(v) => money(v)} />
            </Card>
          ) : null}
          <Card>
            <SectionHeader title="الأقسام: متوسط تغيّر السعر" />
            <Bars items={data.categories.map((c) => ({ label: categoryLabel(c.category), value: c.changePct, hint: `${c.products} منتج · ${c.offers} عرض` }))} format={(v) => `${v > 0 ? "+" : ""}${v}%`} />
            <InfoNote text="القيمة السالبة تعني انخفاض الأسعار في القسم (أخضر)." />
          </Card>
          <Card>
            <SectionHeader title="أكبر انخفاضات الأسعار" icon={TrendingDown} />
            {data.drops.length ? data.drops.map((d) => { const p = find(d.productId); return p ? <ProductRow key={d.productId} product={p} right={<Txt weight="bold" style={{ color: t.green }}>{d.changePct}%</Txt>} /> : <Txt key={d.productId}>{d.name} {d.changePct}%</Txt>; }) : <Txt style={{ color: t.muted }}>لا توجد انخفاضات خلال الفترة.</Txt>}
          </Card>
          {data.rises.length ? (
            <Card>
              <SectionHeader title="ارتفاعات الأسعار" icon={TrendingUp} />
              {data.rises.map((d) => { const p = find(d.productId); return p ? <ProductRow key={d.productId} product={p} right={<Txt weight="bold" style={{ color: t.danger }}>+{d.changePct}%</Txt>} /> : null; })}
            </Card>
          ) : null}
          {data.mostViewed.length ? (
            <Card>
              <SectionHeader title="الأكثر مشاهدة هذا الأسبوع" action="الرائج" onPress={() => router.push("/trending")} />
              {data.mostViewed.map((v) => { const p = find(v.productId); return p ? <ProductRow key={v.productId} product={p} right={<Txt style={{ color: t.muted }}>{v.views} مشاهدة</Txt>} /> : null; })}
            </Card>
          ) : null}
          {demo ? <InfoNote text="بيانات تجريبية من الكتالوج المحلي. عند ربط خادم المتجر تُحسب من سجل الأسعار الفعلي." tone="warn" /> : null}
        </View>
      )}
    </Shell>
  );
}
