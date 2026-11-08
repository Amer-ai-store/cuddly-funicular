// "محسّن السلة" (Basket Optimizer) — cheaper same-category swaps, owner bundles applied at
// checkout, the branch that can fulfil everything, and the free-shipping gap.
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, Gift, MapPin, Sparkles } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { Card, Chip, CTA, ErrorBlock, InfoNote, LoadingBlock, SectionHeader, Segmented, SmallButton } from "../components/design/kit";
import { DemoChip, Stat, useMoney } from "../components/smart/Bits";
import { ProgressBar } from "../components/smart/Charts";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { demoOptimize, freeShippingProgress, type Objective, type Optimization } from "../lib/smart";
import { useTheme } from "../lib/theme";

export default function BasketOptimizer() {
  const { colors: t } = useTheme();
  const money = useMoney();
  const { cart, products, settings, setQuantity, notify, setBranch, branchId } = useStore();
  const { configured } = useSession();
  const [objective, setObjective] = useState<Objective>("cheapest");
  const [data, setData] = useState<Optimization | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const items = Object.entries(cart).filter(([, q]) => q > 0);
  const run = useCallback(async () => {
    setError(""); setLoading(true);
    try {
      if (!configured) setData(demoOptimize(products, cart, objective, settings.freeShippingThreshold, settings.shippingFee));
      else setData(await api.post<Optimization>("/basket/optimize", { objective, branchId, items: Object.entries(cart).filter(([, q]) => q > 0).map(([productId, quantity]) => ({ productId, quantity })) }));
    } catch (e) { setError(e instanceof Error ? e.message : "تعذّر تحسين السلة"); } finally { setLoading(false); }
  }, [configured, products, cart, objective, settings.freeShippingThreshold, settings.shippingFee, branchId]);
  useEffect(() => { if (!items.length) return; const id = setTimeout(() => void run(), 0); return () => clearTimeout(id); }, [objective]); // eslint-disable-line react-hooks/exhaustive-deps
  function swap(fromId: string, toId: string, quantity: number) { setQuantity(fromId, 0); setQuantity(toId, quantity); notify("استُبدل الصنف بالبديل الأوفر"); void run(); }
  if (!items.length) return <Shell title="محسّن السلة" subtitle="وفّر أكثر في كل طلب"><Card style={{ gap: 10, alignItems: "center" }}><Txt style={{ color: t.muted }}>سلتك فارغة؛ أضف منتجات ثم عد لتحسينها.</Txt><CTA title="ابدأ التسوق" onPress={() => router.navigate("/explore")} style={{ alignSelf: "stretch" }} /></Card></Shell>;
  const ship = data ? freeShippingProgress(data.optimizedSubtotal, data.freeShipping.threshold) : null;
  return (
    <Shell title="محسّن السلة" subtitle="بدائل أوفر وحزم توفير وأفضل فرع لطلبك" side={<DemoChip show={!!data?.demo} />}>
      <Segmented testID="optimizer-objective" value={objective} onChange={setObjective} options={[{ value: "cheapest", label: "الأوفر" }, { value: "single-branch", label: "فرع واحد" }, { value: "fastest", label: "الأسرع" }]} />
      {loading && !data ? <LoadingBlock label="نحلل سلتك…" /> : error && !data ? <ErrorBlock message={error} onRetry={() => void run()} /> : data ? (
        <View style={{ gap: 14, marginTop: 14 }} testID="optimizer-result">
          <View style={{ flexDirection: "row-reverse", gap: 8 }}>
            <Stat label="السلة الحالية" value={money(data.subtotal)} />
            <Stat label="بعد التحسين" value={money(data.estimatedTotal)} tone="good" />
            <Stat label="التوفير" value={money(Math.max(0, data.subtotal + (data.subtotal >= data.freeShipping.threshold ? 0 : data.freeShipping.fee) - data.estimatedTotal))} tone="good" />
          </View>
          {ship ? (
            <Card>
              <SectionHeader title={ship.qualified ? "مؤهل للتوصيل المجاني" : "التوصيل المجاني"} />
              <ProgressBar value={ship.progress} color={ship.qualified ? t.green : t.orange} />
              <Txt style={{ color: t.muted, marginTop: 6 }}>{ship.qualified ? `وفّرت رسوم التوصيل ${money(data.freeShipping.fee)}` : `أضف ${money(ship.remaining)} لتوفير ${money(data.freeShipping.fee)}`}</Txt>
            </Card>
          ) : null}
          {data.bundle ? (
            <Card style={{ backgroundColor: t.successSoft }}>
              <SectionHeader title={`حزمة توفير: ${data.bundle.name}`} icon={Gift} />
              <Txt style={{ color: t.ink }}>خصم {data.bundle.percent}% = {money(data.bundle.discount)} على {data.bundle.productIds.length} أصناف — يُطبّق تلقائيًا عند تأكيد الطلب.</Txt>
            </Card>
          ) : null}
          <Card>
            <SectionHeader title="بدائل أوفر من نفس القسم" icon={Sparkles} />
            {data.alternatives.length ? data.alternatives.map((a) => (
              <View key={a.productId} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: t.line, gap: 6 }}>
                <Txt style={{ color: t.muted }}>بدل «{a.name}» ({money(a.price)})</Txt>
                <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}>
                  <View style={{ flex: 1, alignItems: "flex-end" }}><Txt weight="bold" style={{ color: t.title }}>{a.replaceWith.name}</Txt><Txt style={{ color: t.orange }}>{money(a.replaceWith.price)} · ⭐ {a.replaceWith.rating || "—"}</Txt></View>
                  <Chip label={`وفّر ${money(a.saving)}`} tone="success" />
                </View>
                <View style={{ flexDirection: "row-reverse", gap: 8 }}>
                  <SmallButton title="استبدال" onPress={() => swap(a.productId, a.replaceWith.id, a.quantity)} testID={`swap-${a.productId}`} />
                  <SmallButton title="عرض البديل" tone="outline" onPress={() => router.push(`/product/${a.replaceWith.id}`)} />
                </View>
              </View>
            )) : <Txt style={{ color: t.muted }}>{objective === "fastest" ? "وضع «الأسرع» يحافظ على أصنافك كما هي." : "سلتك بالفعل بأفضل الأسعار المتاحة."}</Txt>}
          </Card>
          {data.branches.length ? (
            <Card>
              <SectionHeader title="الفروع القادرة على تجهيز طلبك" icon={MapPin} />
              {data.branches.map((b) => (
                <View key={b.id} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, paddingVertical: 8 }}>
                  <View style={{ flex: 1, alignItems: "flex-end" }}><Txt weight="bold" style={{ color: t.title }}>{b.name}</Txt>{b.missing.length ? <Txt style={{ color: t.muted, fontSize: 12 }}>ينقص: {b.missing.join("، ")}</Txt> : null}</View>
                  {b.canFulfill ? (branchId === b.id ? <Chip label="مختار" tone="success" /> : <SmallButton title="اختيار" onPress={() => { setBranch(b.id); notify(`سيُجهّز الطلب من ${b.name}`); }} />) : <Chip label="غير مكتمل" tone="warn" />}
                </View>
              ))}
            </Card>
          ) : null}
          {data.tips.map((tip) => <InfoNote key={tip} text={tip} />)}
          <CTA title="العودة للسلة" icon={ArrowLeft} onPress={() => router.navigate("/cart")} />
        </View>
      ) : null}
    </Shell>
  );
}
