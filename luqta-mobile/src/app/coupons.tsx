// "محفظة الكوبونات" — public coupons from the store + the one applied to the cart.
import React from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Ticket } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { Card, Chip, ErrorBlock, InfoNote, LoadingBlock, SmallButton } from "../components/design/kit";
import { DemoChip, useMoney } from "../components/smart/Bits";
import { useStore } from "../lib/store";
import { useRemote } from "../lib/useRemote";
import { DEMO_COUPON } from "../lib/checkout";
import type { PublicCoupon } from "../lib/smart";
import { useTheme } from "../lib/theme";
import { useSession } from "../lib/session";

export default function CouponWallet() {
  const { colors: t } = useTheme();
  const money = useMoney();
  const { notify } = useStore();
  const { data, loading, error, demo, reload } = useRemote<{ coupons: PublicCoupon[] }>("/coupons/public", { demo: () => ({ coupons: [{ code: DEMO_COUPON.code, title: "كوبون تجريبي", type: "fixed", value: DEMO_COUPON.discount, minSubtotal: 0, expiresAt: null }] }) });
  const { user } = useSession();
  const mine = useRemote<{ vouchers: PublicCoupon[] }>(user ? "/loyalty/stamps" : null, { auth: true });
  function use(c: PublicCoupon) { notify(`طُبّق الرمز ${c.code} في السلة`); router.navigate({ pathname: "/cart", params: { coupon: c.code } }); }
  return (
    <Shell title="محفظة الكوبونات" subtitle="كوبونات المتجر المتاحة لك الآن" side={<DemoChip show={demo} />}>
      {mine.data?.vouchers.length ? <View style={{ gap: 8, marginBottom: 12 }} testID="my-vouchers"><Txt weight="bold" style={{ color: t.title, fontSize: 18 }}>قسائمي الخاصة</Txt>{mine.data.vouchers.map((v) => <Card key={v.code} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, backgroundColor: t.successSoft }}><Ticket size={28} color={t.green} /><View style={{ flex: 1, alignItems: "flex-end" }}><Txt weight="bold" style={{ color: t.title }}>{v.type === "percent" ? `${v.value}%` : money(v.value)} — {v.title || "قسيمة"}</Txt><Chip label={v.code} tone="neutral" /></View><SmallButton title="استخدم" onPress={() => use(v)} /></Card>)}</View> : null}
      {loading && !data ? <LoadingBlock /> : !data ? <ErrorBlock message={error || "تعذّر التحميل"} onRetry={reload} /> : !data.coupons.length ? <InfoNote text="لا توجد كوبونات عامة حاليًا. تابع العروض والتسجيل اليومي لكسب النقاط." /> : (
        <View style={{ gap: 10 }} testID="coupon-list">
          {data.coupons.map((c) => (
            <Card key={c.code} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 12, borderStyle: "dashed", borderWidth: 2, borderColor: t.chip }}>
              <Ticket size={34} color={t.orange} />
              <View style={{ flex: 1, alignItems: "flex-end", gap: 3 }}>
                <Txt weight="extra" style={{ fontSize: 20, color: t.title }}>{c.type === "percent" ? `${c.value}%` : money(c.value)} خصم</Txt>
                <Txt style={{ color: t.muted }}>{c.title || "كوبون لُقطة"}{c.minSubtotal ? ` · حد أدنى ${money(c.minSubtotal)}` : ""}</Txt>
                <View style={{ flexDirection: "row-reverse", gap: 6 }}><Chip label={c.code} tone="neutral" />{c.expiresAt ? <Chip label={`حتى ${new Date(c.expiresAt).toLocaleDateString("ar")}`} tone="warn" /> : null}</View>
              </View>
              <SmallButton title="استخدم" onPress={() => use(c)} testID={`use-${c.code}`} />
            </Card>
          ))}
        </View>
      )}
    </Shell>
  );
}
