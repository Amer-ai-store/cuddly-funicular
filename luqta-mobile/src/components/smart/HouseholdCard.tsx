// NX-02 / NX-04: predicted weekly basket and monthly budget forecast from the customer's own
// order history — only with the «ذاكرة المنزل» consent. Suggestions are reviewed and added
// by the customer; nothing is bought automatically (لا شراء تلقائي).
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { CalendarClock, Wallet } from "lucide-react-native";
import { Txt } from "../ui";
import { Card, SectionHeader, SmallButton } from "../design/kit";
import { api, ApiError } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useTheme } from "../../lib/theme";
import { useMoney } from "./Bits";

type Item = { productId: string; name: string; price: number; quantity: number; intervalDays: number; dueAt: string; due: boolean };
type Basket = { items: Item[]; basket: Item[]; total: number };
type Forecast = { monthly: number; range: { low: number; high: number }; note: string; lines: { productId: string; name: string; perMonth: number; cost: number }[] };

export function HouseholdCard() {
  const { colors: t } = useTheme();
  const money = useMoney();
  const { setQuantity, cart, notify } = useStore();
  const [state, setState] = useState<{ basket?: Basket; forecast?: Forecast; consent?: boolean; error?: string }>({});
  useEffect(() => {
    let active = true;
    Promise.all([api.get<Basket>("/me/predicted-basket"), api.get<Forecast>("/me/budget-forecast")])
      .then(([basket, forecast]) => { if (active) setState({ basket, forecast, consent: true }); })
      .catch((e: unknown) => { if (!active) return; if (e instanceof ApiError && e.code === "consent_required") setState({ consent: false }); else setState({ error: e instanceof Error ? e.message : "تعذّر التحميل" }); });
    return () => { active = false; };
  }, []);
  if (state.consent === false) return (
    <Card testID="household-consent">
      <SectionHeader title="سلة المنزل المتوقعة" icon={CalendarClock} />
      <Txt style={{ color: t.muted, lineHeight: 22 }}>فعّل «ذاكرة المنزل» لنقترح عليك ما يقترب نفاده من مشترياتك المتكررة ونقدّر ميزانيتك الشهرية. الميزة مطفأة حتى توافق.</Txt>
      <SmallButton title="إدارة الموافقات" onPress={() => router.push("/privacy")} />
    </Card>
  );
  if (!state.basket || !state.forecast) return state.error ? <Txt style={{ color: t.muted }}>{state.error}</Txt> : null;
  const { basket, forecast } = state;
  return (
    <>
      <Card testID="predicted-basket">
        <SectionHeader title="سلة المنزل المتوقعة" icon={CalendarClock} />
        {basket.basket.length ? basket.basket.map((i) => (
          <View key={i.productId} style={{ flexDirection: "row-reverse", justifyContent: "space-between", paddingVertical: 4 }}>
            <Txt style={{ color: t.ink, flex: 1 }}>{i.name} × {i.quantity}</Txt>
            <Txt style={{ color: t.muted, fontSize: 13 }}>كل ~{i.intervalDays} يوم</Txt>
          </View>
        )) : <Txt style={{ color: t.muted }}>لا شيء مستحق هذا الأسبوع. نحتاج طلبين على الأقل للصنف لنتعلم دورته.</Txt>}
        {basket.basket.length ? <SmallButton title={`راجِع وأضف للسلة (${money(basket.total)})`} onPress={() => { for (const i of basket.basket) setQuantity(i.productId, Math.max(cart[i.productId] || 0, i.quantity)); notify("أُضيفت الأصناف للسلة — راجعها قبل الطلب"); router.push("/cart"); }} /> : null}
      </Card>
      <Card testID="budget-forecast">
        <SectionHeader title="تقدير ميزانية الشهر" icon={Wallet} />
        <Txt weight="bold" style={{ color: t.title, fontSize: 20 }}>{money(forecast.monthly)}</Txt>
        <Txt style={{ color: t.muted }}>بين {money(forecast.range.low)} و{money(forecast.range.high)} حسب تغيّر الأسعار</Txt>
        <Txt style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>{forecast.note}</Txt>
      </Card>
    </>
  );
}
