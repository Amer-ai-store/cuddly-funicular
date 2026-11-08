import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Bookmark, ShoppingCart, Tag, Trash } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { ProductImage } from "../components/ProductCard";
import { Mascot } from "../components/Robot";
import { Button, Card, EmptyState, Field, KeyValue, Notice, Row, SectionTitle, Stepper, Txt } from "../components/ui";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { api } from "../lib/api";
import { cartLimit } from "../lib/reorder";

type Quote = { subtotal: number; discount: number; shipping: number; total: number; freeShippingRemaining: number; couponError: string | null; zone: { name: string } | null };

export default function Cart() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { user, configured } = useSession();
  const store = useStore();
  const { products, cart, saved, setQuantity, subtotal, shipping, settings } = store;
  const [coupon, setCoupon] = useState("");
  // A code picked in the coupon wallet arrives as ?coupon= and is applied straight away.
  const { coupon: offered } = useLocalSearchParams<{ coupon?: string }>();
  const [applied, setApplied] = useState("");
  const [lastOffered, setLastOffered] = useState<string | undefined>(undefined);
  if (typeof offered === "string" && offered && offered !== lastOffered) { setLastOffered(offered); setCoupon(offered); setApplied(offered.trim().toUpperCase()); }
  const [serverQuote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState("");
  const lines = useMemo(() => Object.entries(cart).map(([id, quantity]) => ({ product: products.find((p) => p.id === id), quantity })).filter((l) => l.product), [cart, products]);
  const savedLines = useMemo(() => Object.entries(saved).map(([id, quantity]) => ({ product: products.find((p) => p.id === id), quantity })).filter((l) => l.product), [saved, products]);
  // Prices, discount and delivery come from the server when connected; the local estimate is only a fallback.
  useEffect(() => {
    let active = true;
    if (!configured || !lines.length) return;
    const timer = setTimeout(() => {
      api.post<Quote>("/checkout/quote", { items: Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity })), couponCode: applied || undefined, address: { city: "عمان" } })
        .then((q) => { if (active) { setQuote(q); if (applied && q.couponError) { setMessage(q.couponError); setApplied(""); } } }).catch(() => { if (active) setQuote(null); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [cart, applied, configured, lines.length]);
  const quote = configured && lines.length ? serverQuote : null;
  const apply = () => { setMessage(""); setApplied(coupon.trim().toUpperCase()); };
  if (!lines.length && !savedLines.length) return (
    <Shell title="السلة" testID="cart">
      <EmptyState title="سلتك فاضية" detail="أضف منتجات من المتجر أو اطلب من لُقطي أن يجهز لك سلة بميزانيتك." art={<Mascot size={120} motion="sad" interactive={false} />} />
      <Button title={tr("جهز لي سلة بميزانية")} secondary onPress={() => router.navigate({ pathname: "/assistant", params: { q: "جهز لي سلة بـ ٢٠ دينار" } })} />
    </Shell>
  );
  const total = quote ? quote.total : subtotal + shipping;

  const freeLeft = quote ? quote.freeShippingRemaining : Math.max(0, settings.freeShippingThreshold - subtotal);
  return (
    <Shell title="السلة" subtitle={tr("{n} منتجات في سلتك", { n: store.cartCount })} robot={freeLeft > 0 ? tr("باقي {m} على التوصيل المجاني!", { m: money.format(freeLeft) }) : "التوصيل مجاني 🎉"} testID="cart">
      {lines.length ? (
        <View style={{ gap: 10 }}>
          {lines.map(({ product, quantity }) => (
            <Card key={product!.id} style={{ padding: 12 }} testID={`cart-line-${product!.id}`}>
              <Row style={{ alignItems: "flex-start" }}>
                <Pressable accessibilityRole="button" onPress={() => router.push(`/product/${product!.id}`)} style={{ width: 76, height: 76, borderRadius: 18, overflow: "hidden" }}><ProductImage product={product!} /></Pressable>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt weight="bold" numberOfLines={2}>{product!.name}</Txt>
                  <Txt style={{ color: t.muted, fontSize: 12 }}>{product!.unit || product!.subtitle}</Txt>
                  <Txt weight="extra" style={{ color: t.orange }}>{money.format(product!.price * quantity)}</Txt>
                  <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
                    <Stepper value={quantity} onChange={(q) => setQuantity(product!.id, q)} min={1} max={Math.max(1, cartLimit(products, product!.id))} label={product!.name} testID={`stepper-${product!.id}`} />
                    <Row gap={4}>
                      <Pressable testID={`save-later-${product!.id}`} accessibilityRole="button" accessibilityLabel={`${tr("احفظ لوقت لاحق")} ${product!.name}`} onPress={() => store.saveForLater(product!.id)} style={{ padding: 8 }}><Bookmark size={18} color={t.primary} /></Pressable>
                      <Pressable testID={`remove-${product!.id}`} accessibilityRole="button" accessibilityLabel={`${tr("حذف")} ${product!.name}`} onPress={() => setQuantity(product!.id, 0)} style={{ padding: 8 }}><Trash size={18} color={t.danger} /></Pressable>
                    </Row>
                  </Row>
                </View>
              </Row>
            </Card>
          ))}
        </View>
      ) : <Notice text="سلتك فارغة، لكن عندك منتجات محفوظة لوقت لاحق." />}

      {lines.length ? (
        <>
          <Card style={{ marginTop: 14, gap: 8 }}>
            <Row><Tag size={18} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("كود الخصم")}</Txt></Row>
            <Row>
              <View style={{ flex: 1 }}><Field label="أدخل الكود" testID="coupon-input" value={coupon} onChangeText={setCoupon} autoCapitalize="characters" placeholder="WELCOME5" /></View>
              <Button title={tr("تطبيق")} testID="apply-coupon" onPress={apply} disabled={!coupon.trim() || !configured} style={{ marginTop: 22, minHeight: 50 }} />
            </Row>
            {!configured ? <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("أكواد الخصم تتحقق على خادم المتجر.")}</Txt> : null}
            {applied && quote?.discount ? <Notice text={tr("تم تطبيق {c}: وفّرت {m}", { c: applied, m: money.format(quote.discount) })} tone="success" /> : null}
            {message ? <Notice text={message} tone="danger" /> : null}
          </Card>
          <Card style={{ marginTop: 14 }} testID="cart-summary">
            <KeyValue label="المجموع الفرعي" value={money.format(quote?.subtotal ?? subtotal)} />
            {quote?.discount ? <KeyValue label="الخصم" value={`- ${money.format(quote.discount)}`} /> : null}
            <KeyValue label={quote?.zone ? tr("التوصيل ({z})", { z: quote.zone.name }) : "التوصيل (تقديري)"} value={money.format(quote?.shipping ?? shipping)} />
            <View style={{ height: 6, borderRadius: 3, backgroundColor: t.line, marginVertical: 8, overflow: "hidden" }}><View style={{ width: `${Math.min(100, Math.round(((quote?.subtotal ?? subtotal) / Math.max(1, settings.freeShippingThreshold)) * 100))}%`, height: 6, backgroundColor: t.success }} /></View>
            <KeyValue label="الإجمالي" value={money.format(total)} strong testID="cart-total" />
            {money.approx(total) ? <Txt style={{ color: t.muted, fontSize: 12 }}>{money.approx(total)}</Txt> : null}
          </Card>
          <Button title={tr(user ? "متابعة الطلب" : "سجّل الدخول للمتابعة")} testID="checkout" icon={<ShoppingCart size={18} color={t.onAccent} />} onPress={() => router.push(user ? { pathname: "/checkout", params: applied ? { coupon: applied } : {} } : "/login")} style={{ marginTop: 14 }} />
        </>
      ) : null}

      {savedLines.length ? (
        <View testID="saved-for-later">
          <SectionTitle title="محفوظة لوقت لاحق" />
          {savedLines.map(({ product, quantity }) => (
            <Card key={product!.id} style={{ padding: 12, marginBottom: 8 }}>
              <Row>
                <View style={{ width: 56, height: 56, borderRadius: 14, overflow: "hidden" }}><ProductImage product={product!} /></View>
                <View style={{ flex: 1 }}><Txt weight="bold" numberOfLines={1}>{product!.name}</Txt><Txt style={{ color: t.muted, fontSize: 12 }}>{tr("الكمية {n}", { n: quantity })} · {money.format(product!.price)}</Txt></View>
                <Button title={tr("انقل للسلة")} testID={`move-to-cart-${product!.id}`} onPress={() => store.moveToCart(product!.id)} style={{ minHeight: 40, paddingVertical: 6, paddingHorizontal: 12 }} />
                <Pressable accessibilityRole="button" accessibilityLabel={tr("حذف")} onPress={() => store.removeSaved(product!.id)} style={{ padding: 8 }}><Trash size={16} color={t.muted} /></Pressable>
              </Row>
            </Card>
          ))}
        </View>
      ) : null}
    </Shell>
  );
}
