import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Share, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Bell, BellRing, Box, GitCompare, Heart, Play, Share2, ShieldCheck, Sparkles, Star, Truck, RotateCcw } from "lucide-react-native";
import { Shell } from "../../components/Shell";
import { ProductCard, ProductImage } from "../../components/ProductCard";
import { ProductReviews } from "../../components/ProductReviews";
import { VideoPlayer } from "../../components/VideoPlayer";
import { Countdown } from "../../components/Countdown";
import { FlashBadges, TogetherSection, useProductEvents } from "../../components/smart/ProductExtras";
import { PriceInsight } from "../../components/smart/PriceInsight";
import { NutritionCard } from "../../components/smart/NutritionCard";
import { Badge, Button, Card, Chip, EmptyState, Field, KeyValue, Notice, Row, SectionTitle, Stepper, Tabs, Txt } from "../../components/ui";
import { useStore } from "../../lib/store";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { useMoney } from "../../lib/money";
import { useApi } from "../../lib/useApi";
import { api } from "../../lib/api";
import { useRobot } from "../../lib/robot";
import { products as seededProducts, type Product } from "../../data/products";
import { ASSET_URI, productGalleries } from "../../lib/designAssets";

type Question = { id: string; question: string; askedBy: string; createdAt: string; answers: { id: string; answer: string; official: boolean; by: string }[] };

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductContent key={id || "new"} id={id} />;
}

function ProductContent({ id }: { id: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { user, configured } = useSession();
  const store = useStore();
  const robot = useRobot();
  const { products, cart, favorites, compareIds, catalogStatus, rememberProduct, setQuantity, toggleFavorite, toggleCompare, notify } = store;
  const [quantity, setSelectedQuantity] = useState(1);
  const [variantId, setVariantId] = useState(id || "");
  const [media, setMedia] = useState(0);
  const [color, setColor] = useState(0);
  const [tab, setTab] = useState<"specs" | "compare" | "questions" | "reviews">("specs");
  const [question, setQuestion] = useState("");
  const [answerFor, setAnswerFor] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [target, setTarget] = useState("");
  const requested = products.find((p) => p.id === id);
  const product = requested?.variantOf ? products.find((p) => p.id === requested.variantOf) || requested : requested;
  const variants = product ? products.filter((p) => p.variantOf === product.id && p.active !== false) : [];
  const requiresVariant = variants.length > 0;
  const selectedVariant = variants.find((p) => p.id === variantId);
  const selectedProduct = requiresVariant ? selectedVariant : product;
  const summary = useApi<{ summary: string; highlights: string[] }>(product ? `/products/${product.id}/summary` : null);
  const substitutes = useApi<{ outOfStock: boolean; substitutes: (Product & { priceDifference: number })[] }>(product ? `/products/${product.id}/substitutes` : null);
  const questions = useApi<{ questions: Question[] }>(product ? `/products/${product.id}/questions` : null);
  useEffect(() => { if (product?.id) rememberProduct(product.id); }, [product?.id, rememberProduct]);
  useProductEvents(product?.id);
  if (!product) return <Shell title="تفاصيل المنتج"><EmptyState title="المنتج غير متاح" detail={catalogStatus === "loading" ? "جارٍ تحميل الكتالوج…" : "قد يكون المنتج مؤرشفًا أو الرابط غير صحيح."} /></Shell>;
  const available = selectedProduct?.stock === undefined ? (requiresVariant ? 0 : 10) : Math.max(0, selectedProduct.stock);
  const remaining = Math.min(99, available - (selectedProduct ? cart[selectedProduct.id] || 0 : 0));
  const liked = favorites.includes(product.id), compared = compareIds.includes(product.id);
  // The mockups show more views of some products; add them only while the merchant keeps the catalog's own photos.
  const seeded = seededProducts.find((item) => item.id === product.id);
  const extraViews = seeded && JSON.stringify(product.images || []) === JSON.stringify(seeded.images || []) ? (productGalleries[product.id] || []).map((key) => ASSET_URI + key) : [];
  const gallery = [...(product.images?.length ? product.images : [typeof product.image === "string" ? product.image : ""]), ...extraViews].filter((v, i, all) => all.indexOf(v) === i);
  const hexColors = (product.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const price = selectedProduct?.price ?? product.price;
  async function share() {
    const link = `luqta://product/${encodeURIComponent(product!.id)}`;
    try { await Share.share({ title: product!.name, message: `${product!.name} — ${money.format(price)}\n${link}`, url: link }); } catch (e) { notify(e instanceof Error ? e.message : "تعذّرت مشاركة المنتج"); }
  }
  function add() {
    if (!selectedProduct) { notify("اختر المقاس أو اللون أولًا"); return; }
    if (remaining < 1) { notify("الكمية المتاحة موجودة في سلتك أو نفد المخزون"); return; }
    const chosen = Math.min(quantity, remaining);
    setQuantity(selectedProduct.id, (cart[selectedProduct.id] || 0) + chosen);
    notify(chosen === quantity ? "أُضيف المنتج إلى سلتك" : `أُضيفت ${chosen} قطع حسب الكمية المتاحة`);
    robot.react("cart");
  }
  function buyNow() {
    if (!selectedProduct) { notify("اختر المقاس أو اللون أولًا"); return; }
    store.startBuyNow(selectedProduct.id, Math.min(quantity, Math.max(1, available)));
    router.push({ pathname: "/checkout", params: { mode: "buy-now" } });
  }
  async function ask() {
    if (!user) { router.push("/login"); return; }
    try { await api.post(`/products/${product!.id}/questions`, { question }); setQuestion(""); questions.reload(); notify("أُرسل سؤالك"); } catch (e) { notify(e instanceof Error ? e.message : "تعذر إرسال السؤال"); }
  }
  async function reply(questionId: string) {
    try { await api.post(`/questions/${questionId}/answers`, { answer }); setAnswer(""); setAnswerFor(null); questions.reload(); } catch (e) { notify(e instanceof Error ? e.message : "تعذر إرسال الإجابة"); }
  }
  async function alert(type: "price" | "stock") {
    if (!user) { router.push("/login"); return; }
    try {
      await api.post(`/products/${product!.id}/alerts`, type === "price" ? { type, targetPrice: Number(target) || Math.round(product!.price * 90) / 100 } : { type });
      notify(type === "price" ? "سننبهك عند انخفاض السعر" : "سننبهك عند عودة المنتج");
    } catch (e) { notify(e instanceof Error ? e.message : "تعذر إنشاء التنبيه"); }
  }
  const similar = products.filter((p) => !p.variantOf && p.category === product.category && p.id !== product.id).slice(0, 4);
  const showVideo = media === gallery.length && !!product.video;
  return (
    <Shell title={product.name} subtitle={product.unit || product.subtitle} back testID="product">
      <View style={{ gap: 14 }}>
        <View style={{ borderRadius: 28, overflow: "hidden", backgroundColor: t.imageBackground, height: 300 }}>
          {showVideo ? <VideoPlayer uri={product.video!} title={product.name} /> : <ProductImage product={product} uri={gallery[media] || undefined} />}
          {product.flash ? <View style={{ position: "absolute", top: 12, right: 12 }}><Countdown endsAt={product.flash.endsAt} /></View> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} testID="gallery">
          {gallery.map((uri, i) => (
            <Pressable key={`${uri}-${i}`} accessibilityRole="button" accessibilityLabel={`${tr("صورة")} ${i + 1}`} onPress={() => setMedia(i)} style={{ width: 64, height: 64, borderRadius: 16, overflow: "hidden", borderWidth: 2, borderColor: media === i ? t.primary : t.line }}><ProductImage product={product} uri={uri || undefined} /></Pressable>
          ))}
          {product.video ? <Pressable testID="video-thumb" accessibilityRole="button" accessibilityLabel={tr("فيديو المنتج")} onPress={() => setMedia(gallery.length)} style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: t.ink, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: showVideo ? t.orange : t.ink }}><Play size={22} color="#FFFFFF" fill="#FFFFFF" /></Pressable> : null}
          <Pressable testID="open-3d" accessibilityRole="button" accessibilityLabel={tr("عرض ثلاثي الأبعاد")} onPress={() => router.push(`/try/${product.id}`)} style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: t.primarySoft, alignItems: "center", justifyContent: "center", gap: 2 }}><Box size={20} color={t.primary} /><Txt weight="extra" style={{ fontSize: 11, color: t.primary }}>3D</Txt></Pressable>
        </ScrollView>

        <Card style={{ gap: 10 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt style={{ color: t.muted, fontSize: 13 }}>{product.brand}</Txt>
            <Row gap={6}>
              <Pressable testID="favorite-detail" accessibilityRole="button" accessibilityLabel={tr(liked ? "إزالة من المفضلة" : "حفظ في المفضلة")} onPress={() => toggleFavorite(product.id)} style={{ padding: 8 }}><Heart size={20} color={liked ? t.orange : t.ink} fill={liked ? t.orange : "transparent"} /></Pressable>
              <Pressable testID="share" accessibilityRole="button" accessibilityLabel={tr("مشاركة")} onPress={() => void share()} style={{ padding: 8 }}><Share2 size={20} color={t.ink} /></Pressable>
            </Row>
          </Row>
          <Row gap={6}><Star size={15} color={t.warning} fill={product.reviews ? t.warning : "transparent"} /><Txt style={{ fontSize: 13 }}>{product.reviews ? tr("{r} ({n} تقييم)", { r: product.rating, n: product.reviews }) : tr("لا توجد تقييمات موثقة بعد")}</Txt></Row>
          <Row wrap style={{ alignItems: "flex-end" }}>
            <Txt weight="extra" style={{ fontSize: 28, color: t.orange }} testID="price">{money.format(price)}</Txt>
            {product.oldPrice && product.oldPrice > product.price ? <Txt style={{ textDecorationLine: "line-through", color: t.muted }}>{money.format(product.oldPrice)}</Txt> : null}
            {money.approx(price) ? <Txt style={{ color: t.muted, fontSize: 12 }}>{money.approx(price)}</Txt> : null}
          </Row>
          {summary.data ? (
            <View style={{ backgroundColor: t.primarySoft, borderRadius: 18, padding: 12, gap: 6 }} testID="smart-summary">
              <Row gap={6}><Sparkles size={15} color={t.primary} /><Txt weight="bold" style={{ color: t.primary, fontSize: 13 }}>{tr("ملخص لُقطي")}</Txt></Row>
              <Txt style={{ fontSize: 13, lineHeight: 22 }}>{summary.data.summary}</Txt>
            </View>
          ) : <Txt style={{ color: t.muted, lineHeight: 24 }}>{product.description}</Txt>}
          {hexColors.length ? <View style={{ gap: 6 }}>
            <Txt weight="bold" style={{ fontSize: 13 }}>{tr("الألوان")}</Txt>
            <Row>{hexColors.map((c, i) => <Pressable key={c} accessibilityRole="button" accessibilityLabel={`${tr("اللون")} ${i + 1}`} aria-selected={color === i} onPress={() => setColor(i)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c, borderWidth: 3, borderColor: color === i ? t.primary : t.paper }} />)}</Row>
          </View> : null}
          {requiresVariant ? <View style={{ gap: 8 }}>
            <Txt weight="bold" style={{ fontSize: 13 }}>{tr("اختر المقاس أو اللون · كل خيار له مخزون مستقل")}</Txt>
            <Row wrap>{variants.map((v) => <Chip key={v.id} testID={`variant-${v.id}`} label={`${v.variantLabel || v.id} · ${v.stock ?? 0}`} active={v.id === variantId} onPress={() => { setVariantId(v.id); setSelectedQuantity(1); }} />)}</Row>
          </View> : null}
          <Txt style={{ color: available > 0 ? t.success : t.danger, fontSize: 13 }}>{available > 0 ? tr("المتوفر: {n}", { n: available }) : tr("نفد المخزون")}</Txt>
          <Row>
            <Stepper value={quantity} onChange={setSelectedQuantity} min={1} max={Math.max(1, remaining)} label={product.name} testID="quantity" />
            <View style={{ flex: 1 }}><Button title={tr(requiresVariant && !selectedVariant ? "اختر المقاس أو اللون" : "أضف إلى السلة")} testID="add-to-cart" disabled={remaining <= 0 || (requiresVariant && !selectedVariant)} onPress={add} /></View>
          </Row>
          <Button title={tr("اشترِ الآن")} testID="buy-now" tone="primary" disabled={available <= 0 || (requiresVariant && !selectedVariant)} onPress={buyNow} />
          {available <= 0 ? (
            <Button title={tr("نبّهني عند التوفر")} testID="alert-stock" secondary icon={<Bell size={16} color={t.ink} />} onPress={() => void alert("stock")} />
          ) : (
            <Row>
              <View style={{ flex: 1 }}><TextInput testID="alert-target" accessibilityLabel={tr("السعر المستهدف")} value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder={tr("نبّهني إذا نزل السعر إلى…")} placeholderTextColor={t.muted} style={{ minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: t.line, paddingHorizontal: 12, color: t.ink, backgroundColor: t.paper, fontFamily: "Tajawal_500Medium" }} /></View>
              <Button title={tr("تنبيه")} testID="alert-price" secondary icon={<BellRing size={16} color={t.ink} />} onPress={() => void alert("price")} style={{ minHeight: 46, paddingVertical: 8 }} />
            </Row>
          )}
        </Card>

        <Row style={{ justifyContent: "space-around" }}>
          {[[Truck, "توصيل في نفس اليوم"], [RotateCcw, "إرجاع خلال 14 يومًا"], [ShieldCheck, "جودة مضمونة"]].map(([Icon, label]) => {
            const I = Icon as typeof Truck;
            return <View key={label as string} style={{ alignItems: "center", gap: 6, flex: 1 }}><View style={{ width: 44, height: 44, borderRadius: 16, backgroundColor: t.primarySoft, alignItems: "center", justifyContent: "center" }}><I size={20} color={t.primary} /></View><Txt style={{ fontSize: 11, textAlign: "center" }}>{tr(label as string)}</Txt></View>;
          })}
        </Row>

        <Tabs testID="product-tabs" value={tab} onChange={setTab} tabs={[{ id: "specs", label: "المواصفات" }, { id: "compare", label: "مقارنة" }, { id: "questions", label: "أسئلة", count: questions.data?.questions.length }, { id: "reviews", label: "التقييمات" }]} />
        {tab === "specs" ? (
          <Card testID="specs">
            {(product.specs || []).map((s) => <KeyValue key={s.label} label={s.label} value={s.value} />)}
            {product.barcode ? <KeyValue label="الباركود" value={product.barcode} /> : null}
            {product.features.map((f) => <Txt key={f} style={{ color: t.muted, marginTop: 4 }}>• {f}</Txt>)}
          </Card>
        ) : null}
        {tab === "compare" ? (
          <Card style={{ gap: 10 }} testID="compare-tab">
            <Button title={tr(compared ? "إزالة من المقارنة" : "أضف للمقارنة")} testID="toggle-compare" secondary icon={<GitCompare size={16} color={t.ink} />} onPress={() => toggleCompare(product.id)} />
            {compared ? <Button title={tr("عرض جدول المقارنة")} onPress={() => router.push({ pathname: "/favorites", params: { tab: "compare" } })} /> : null}
            {similar.map((p) => <KeyValue key={p.id} label={p.name} value={`${money.format(p.price)} · ⭐ ${p.rating || "—"}`} />)}
          </Card>
        ) : null}
        {tab === "questions" ? (
          <Card style={{ gap: 10 }} testID="questions">
            {!configured ? <Notice text="الأسئلة متاحة عند الاتصال بخادم المتجر." /> : null}
            {(questions.data?.questions || []).map((q) => (
              <View key={q.id} style={{ gap: 4, borderBottomWidth: 1, borderBottomColor: t.line, paddingBottom: 10 }}>
                <Txt weight="bold">❓ {q.question}</Txt>
                <Txt style={{ fontSize: 11, color: t.muted }}>{tr("سأل {name}", { name: q.askedBy })}</Txt>
                {q.answers.map((a) => <View key={a.id} style={{ flexDirection: "row-reverse", gap: 6, alignItems: "flex-start" }}>{a.official ? <Badge label="رد رسمي" tone="success" /> : null}<Txt style={{ flex: 1, fontSize: 13 }}>{a.answer} — <Txt style={{ color: t.muted, fontSize: 11 }}>{a.by}</Txt></Txt></View>)}
                {answerFor === q.id ? <Row><View style={{ flex: 1 }}><Field label="إجابتك" value={answer} onChangeText={setAnswer} testID="answer-input" /></View><Button title={tr("إرسال")} onPress={() => void reply(q.id)} disabled={answer.trim().length < 2} style={{ marginTop: 22 }} /></Row> : user ? <Pressable accessibilityRole="button" onPress={() => setAnswerFor(q.id)}><Txt style={{ color: t.primary, fontSize: 12 }}>{tr("أجب عن السؤال")}</Txt></Pressable> : null}
              </View>
            ))}
            <Field label="اسأل عن المنتج" testID="question-input" value={question} onChangeText={setQuestion} placeholder={tr("مثلًا: هل يناسب الأطفال؟")} />
            <Button title={tr("أرسل السؤال")} testID="ask-question" disabled={question.trim().length < 5} onPress={() => void ask()} />
          </Card>
        ) : null}
        {tab === "reviews" ? <ProductReviews productId={product.id} /> : null}

        <FlashBadges product={product} />
        {product.nutrition ? <NutritionCard nutrition={product.nutrition} /> : null}
        <PriceInsight product={product} />
        <TogetherSection product={product} />

        {substitutes.data?.outOfStock && substitutes.data.substitutes.length ? (
          <View testID="substitutes">
            <SectionTitle title="بدائل متوفرة الآن" subtitle="اخترناها من نفس القسم وبسعر قريب" />
            <Row wrap style={{ justifyContent: "space-between" }}>{substitutes.data.substitutes.map((p) => <ProductCard key={p.id} product={p} width="48%" />)}</Row>
          </View>
        ) : similar.length ? (
          <View>
            <SectionTitle title="قد يعجبك أيضًا" subtitle="من القسم نفسه" />
            <Row wrap style={{ justifyContent: "space-between" }}>{similar.map((p) => <ProductCard key={p.id} product={p} width="48%" />)}</Row>
          </View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/assistant", params: { q: tr("هل {name} مناسب لي؟", { name: product.name }) } })} style={{ padding: 15, backgroundColor: t.orangeSoft, borderRadius: 18 }}><Txt weight="bold" style={{ color: t.orange }}>{tr("اسأل لُقطي عن هذا المنتج")}</Txt></Pressable>
      </View>
    </Shell>
  );
}
