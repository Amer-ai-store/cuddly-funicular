// "ماسح السعرات" (Calorie & nutrition scan) — product facts by barcode, cart totals,
// and an AI photo estimate when the server has a provider key.
import React, { useState } from "react";
import { View } from "react-native";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { Card, CTA, InfoNote, SectionHeader } from "../components/design/kit";
import { ProductRow } from "../components/smart/Bits";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { NutritionCard } from "../components/smart/NutritionCard";
import { cartNutrition } from "../lib/smart";
import { useStore } from "../lib/store";
import { useTheme } from "../lib/theme";
import type { Product } from "../data/products";

export default function NutritionScreen() {
  const { colors: t } = useTheme();
  const { products, cart } = useStore();
  const [scanning, setScanning] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [msg, setMsg] = useState("");
  const totals = cartNutrition(products, cart);
  const withFacts = products.filter((p) => p.nutrition).slice(0, 8);
  function onCode(code: string) {
    setScanning(false); setMsg("");
    const p = products.find((x) => x.barcode === code || x.sku === code) || null;
    setProduct(p);
    if (!p) setMsg(`لا يوجد منتج بالباركود ${code}`); else if (!p.nutrition) setMsg("لم يضف المتجر القيم الغذائية لهذا المنتج بعد.");
  }
  return (
    <Shell title="ماسح السعرات" subtitle="اعرف القيم الغذائية قبل أن تضيف للسلة">
      <CTA title="امسح باركود المنتج" onPress={() => setScanning(true)} testID="nutrition-scan" />
      <BarcodeScanner visible={scanning} onClose={() => setScanning(false)} onCode={onCode} />
      {msg ? <View style={{ marginTop: 10 }}><InfoNote text={msg} tone="warn" /></View> : null}
      {product ? <Card style={{ marginTop: 12 }}><ProductRow product={product} /></Card> : null}
      {product?.nutrition ? <NutritionCard nutrition={product.nutrition} /> : null}
      {withFacts.length ? <Card style={{ marginTop: 12, gap: 8 }} testID="nutrition-picks">
        <SectionHeader title="منتجات بقيم غذائية" />
        {withFacts.map((p) => <ProductRow key={p.id} product={p} onPress={() => { setProduct(p); setMsg(""); }} />)}
      </Card> : null}
      <Card style={{ marginTop: 14 }} testID="cart-nutrition">
        <SectionHeader title="القيم الغذائية لسلتك" />
        {totals.covered ? <Txt style={{ color: t.ink, lineHeight: 26 }}>{totals.total.calories} سعرة · بروتين {totals.total.protein}غ · كربوهيدرات {totals.total.carbs}غ · دهون {totals.total.fat}غ · سكر {totals.total.sugar}غ</Txt> : null}
        <Txt style={{ color: t.muted, fontSize: 13 }}>{totals.items ? `محسوبة لـ ${totals.covered} من ${totals.items} صنف تتوفر لها قيم غذائية.` : "سلتك فارغة."}</Txt>
      </Card>
    </Shell>
  );
}
