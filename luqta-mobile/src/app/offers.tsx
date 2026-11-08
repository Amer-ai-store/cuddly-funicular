import React from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Zap } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { ProductGrid } from "../components/ProductGrid";
import { ProductCard } from "../components/ProductCard";
import { Countdown } from "../components/Countdown";
import { Button, EmptyState, Row, SectionTitle, Txt } from "../components/ui";
import { useStore } from "../lib/store";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import type { Product } from "../data/products";

type Deal = { id: string; product: Product; price: number; endsAt: string; remaining: number | null; limit: number | null; sold: number };

export default function Offers() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { products, catalogStatus } = useStore();
  const deals = useApi<{ serverTime: string; deals: Deal[] }>("/flash-deals");
  const offers = products.filter((p) => !p.variantOf && p.oldPrice !== undefined && p.oldPrice > p.price && p.stock !== 0 && !p.flash).sort((a, b) => (b.oldPrice! - b.price) / b.oldPrice! - (a.oldPrice! - a.price) / a.oldPrice!);
  return (
    <Shell title="العروض" subtitle="عروض خاطفة بعدّاد، وتخفيضات من الكتالوج" robot="الحق العروض قبل ما تخلص ⚡" testID="offers">
      {deals.data?.deals.length ? (
        <View testID="flash-section">
          <Row><Zap size={20} color={t.orange} fill={t.orange} /><Txt weight="extra" style={{ fontSize: 20 }}>{tr("عروض خاطفة")}</Txt></Row>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 12 }}>
            {deals.data.deals.map((d) => (
              <View key={d.id} style={{ width: 190, gap: 6 }} testID={`deal-${d.product.id}`}>
                <Countdown endsAt={d.endsAt} serverTime={deals.data?.serverTime} onEnd={deals.reload} />
                <ProductCard product={{ ...d.product, price: d.price }} width={190} />
                {d.limit ? <View style={{ height: 6, borderRadius: 3, backgroundColor: t.line }}><View style={{ width: `${Math.round((d.sold / d.limit) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: t.orange }} /></View> : null}
                {d.limit ? <Txt style={{ fontSize: 11, color: t.muted }}>{tr("بيع {s} من {l}", { s: d.sold, l: d.limit })}</Txt> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {catalogStatus !== "connected" ? <Txt style={{ color: t.muted, marginBottom: 12 }}>{tr("هذه العروض للكتالوج التجريبي حتى يتصل التطبيق بالخادم.")}</Txt> : null}
      <SectionTitle title="تخفيضات" subtitle={offers.length ? tr("{n} منتجات بسعر أقل من السابق", { n: offers.length }) : undefined} />
      {offers.length ? <ProductGrid items={offers} /> : <View style={{ gap: 12 }}><EmptyState title="لا توجد تخفيضات حالية" detail="يضيف المدير السعر السابق والسعر الحالي من لوحة الإدارة." action="" /><Button secondary title={tr("تصفح كل المنتجات")} onPress={() => router.push("/explore")} /></View>}
    </Shell>
  );
}
