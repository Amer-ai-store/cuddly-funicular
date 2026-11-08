// "رؤى الإنفاق" — monthly spend, categories, savings and money-saving tips from real orders.
import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Leaf, Lightbulb } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { AccountGate } from "../components/AccountKit";
import { Card, ErrorBlock, InfoNote, LoadingBlock, SectionHeader, SmallButton } from "../components/design/kit";
import { Bars } from "../components/smart/Charts";
import { Stat, useMoney } from "../components/smart/Bits";
import { HouseholdCard } from "../components/smart/HouseholdCard";
import { useSession } from "../lib/session";
import { categoryLabel } from "../data/products";
import { useRemote } from "../lib/useRemote";
import type { Insights } from "../lib/smart";
import { useTheme } from "../lib/theme";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export default function InsightsScreen() {
  return <Shell title="رؤى الإنفاق" subtitle="اعرف أين يذهب مالك وكيف توفر أكثر"><AccountGate><Body /></AccountGate></Shell>;
}
function Body() {
  const { colors: t } = useTheme();
  const money = useMoney();
  const { data, loading, error, reload } = useRemote<Insights>("/me/insights", { auth: true });
  const { configured, user } = useSession();
  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBlock message={error || "تعذّر التحميل"} onRetry={reload} />;
  return (
    <View style={{ gap: 14 }} testID="insights">
      <View style={{ flexDirection: "row-reverse", gap: 8 }}>
        <Stat label="إجمالي الإنفاق" value={money(data.spent)} />
        <Stat label="وفّرت" value={money(data.saved)} tone="good" />
        <Stat label="متوسط السلة" value={money(data.avgBasket)} />
      </View>
      {data.monthly.length ? <Card><SectionHeader title="الإنفاق الشهري" /><Bars items={data.monthly.map((m) => ({ label: `${MONTHS[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`, value: m.total }))} format={(v) => money(v)} /></Card> : <InfoNote text="لا توجد طلبات بعد — ستظهر الرؤى بعد أول طلب." />}
      {data.byCategory.length ? <Card><SectionHeader title="حسب القسم" /><Bars color={t.purple} items={data.byCategory.map((c) => ({ label: categoryLabel(c.category), value: c.total, hint: `${c.share}%` }))} format={(v) => money(v)} /></Card> : null}
      <Card>
        <SectionHeader title="نصائح التوفير" icon={Lightbulb} />
        {data.tips.map((tip) => <Txt key={tip} style={{ color: t.ink, lineHeight: 25, marginBottom: 6 }}>• {tip}</Txt>)}
        <SmallButton title="فعّل تنبيهات الأسعار" onPress={() => router.push("/watchlist")} />
      </Card>
      {configured && user ? <HouseholdCard /> : null}
      <Card style={{ backgroundColor: t.successSoft }}>
        <SectionHeader title="أثرك الأخضر" icon={Leaf} />
        <Txt style={{ color: t.ink }}>{data.green.ecoOrders} طلب بتوصيل مجمّع ≈ {data.green.co2SavedKg} كغ CO₂ أقل.</Txt>
      </Card>
    </View>
  );
}
