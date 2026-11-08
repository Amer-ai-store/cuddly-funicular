// #4 Price Fairness Passport + #5 Offer Truth: price per kg/litre, when and from where the
// price was last synced, 90-day range, and whether a "was" price is backed by history.
import React from "react";
import { View } from "react-native";
import { BadgeCheck, ShieldAlert } from "lucide-react-native";
import { Txt } from "../ui";
import { Card } from "../design/kit";
import { useRemote } from "../../lib/useRemote";
import { useTheme } from "../../lib/theme";
import { useMoney } from "./Bits";
import type { Product } from "../../data/products";

type Passport = { unitPrice: { value: number; per: string } | null; updatedAt: string; source: { kind: string; at: string }; low90: number; high90: number; changes90: number; offer: { claim: boolean; verdict: string } };
const PER: Record<string, string> = { kg: "للكيلو", l: "للتر", piece: "للقطعة" };

export function PricePassport({ product }: { product: Product }) {
  const { colors: t } = useTheme();
  const money = useMoney();
  const { data } = useRemote<Passport>(`/products/${encodeURIComponent(product.id)}/passport`);
  if (!data) return null;
  const verified = data.offer.verdict === "verified";
  return (
    <Card style={{ marginTop: 12, gap: 6 }} testID="price-passport">
      <Txt weight="bold" style={{ color: t.title, fontSize: 16 }}>جواز السعر</Txt>
      {data.unitPrice ? <Txt style={{ color: t.ink }}>{money(data.unitPrice.value)} {PER[data.unitPrice.per] || ""}</Txt> : null}
      <Txt style={{ color: t.muted, fontSize: 13 }}>آخر تحديث {new Date(data.updatedAt).toLocaleDateString("ar-JO")} · المصدر: {data.source.kind === "inventory_import" ? "استيراد مخزون المتجر" : "كتالوج المتجر"} · نطاق 90 يومًا {money(data.low90)} – {money(data.high90)} ({data.changes90} تغيير)</Txt>
      {data.offer.claim ? <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6 }}>
        {verified ? <BadgeCheck size={18} color={t.green} /> : <ShieldAlert size={18} color={t.orange} />}
        <Txt style={{ color: verified ? t.green : t.orange, fontSize: 13 }}>{verified ? "السعر قبل الخصم موثّق: بيع به فعلًا خلال آخر 30 يومًا" : "السعر قبل الخصم غير موثّق في سجل آخر 30 يومًا"}</Txt>
      </View> : null}
    </Card>
  );
}
