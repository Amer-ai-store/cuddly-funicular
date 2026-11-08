// "الرائج الآن" (Viral discovery) — ranked by real views, shares and orders this week.
import React from "react";
import { View } from "react-native";
import { Eye, Flame, Share2, ShoppingBag } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { Card, ErrorBlock, InfoNote, LoadingBlock } from "../components/design/kit";
import { DemoChip, ProductRow } from "../components/smart/Bits";
import { useStore } from "../lib/store";
import { useRemote } from "../lib/useRemote";
import type { Product } from "../data/products";
import { useTheme } from "../lib/theme";

type Trending = Product & { trend?: { views: number; shares: number; ordered: number; score: number } };
export default function TrendingScreen() {
  const { colors: t } = useTheme();
  const { products } = useStore();
  const { data, loading, error, demo, reload } = useRemote<{ products: Trending[] }>("/trending", { demo: () => ({ products: [...products].sort((a, b) => b.reviews - a.reviews).slice(0, 10) }) });
  return (
    <Shell title="الرائج الآن" subtitle="الأكثر مشاهدة ومشاركة وطلبًا هذا الأسبوع" side={<DemoChip show={demo} />}>
      {loading && !data ? <LoadingBlock /> : !data ? <ErrorBlock message={error || "تعذّر التحميل"} onRetry={reload} /> : !data.products.length ? <InfoNote text="لا توجد بيانات كافية هذا الأسبوع بعد." /> : (
        <Card testID="trending-list">
          {data.products.map((p, i) => {
            const local = products.find((x) => x.id === p.id) || p;
            return (
              <View key={p.id} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
                <Txt weight="extra" style={{ width: 28, textAlign: "center", fontSize: 18, color: i < 3 ? t.orange : t.muted }}>{i + 1}</Txt>
                <View style={{ flex: 1 }}><ProductRow product={local} right={p.trend ? (
                  <View style={{ alignItems: "flex-start", gap: 2 }}>
                    <Txt style={{ fontSize: 12, color: t.muted }}><Eye size={12} color={t.muted} /> {p.trend.views}</Txt>
                    <Txt style={{ fontSize: 12, color: t.muted }}><Share2 size={12} color={t.muted} /> {p.trend.shares}</Txt>
                    <Txt style={{ fontSize: 12, color: t.muted }}><ShoppingBag size={12} color={t.muted} /> {p.trend.ordered}</Txt>
                  </View>) : i < 3 ? <Flame size={20} color={t.orange} /> : null} /></View>
              </View>
            );
          })}
        </Card>
      )}
      {demo ? <InfoNote text="ترتيب تجريبي حسب عدد التقييمات؛ مع الخادم يُحسب من المشاهدات والمشاركات والطلبات." tone="warn" /> : null}
    </Shell>
  );
}
