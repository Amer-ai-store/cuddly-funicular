import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Heart, Plus, Star, ShoppingBag, Zap } from "lucide-react-native";
import { router } from "expo-router";
import { Product, products as sampleProducts } from "../data/products";
import { useStore } from "../lib/store";
import { useMoney } from "../lib/money";
import { useI18n } from "../lib/i18n";
import { Palette, useTheme, useThemedStyles } from "../lib/theme";
import { Txt } from "./ui";
import { ASSET_URI, cutoutImages, productImages } from "../lib/designAssets";


// Looked up for every card on every render, so a map instead of a search through the list.
const SAMPLE_BY_ID = new Map(sampleProducts.map((item) => [item.id, item]));

// Photo when the product has one; otherwise an illustrated tile (emoji on the product colour) so groceries still look great.
export function ProductImage({ product, style, uri }: { product: Product; style?: object; uri?: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const source = uri ?? product.image;
  const sourceKey = `${product.id}:${String(source)}`;
  const [failedSource, setFailedSource] = React.useState("");
  const failed = failedSource === sourceKey;
  const original = SAMPLE_BY_ID.get(product.id);
  // "asset:<key>" names a bundled image directly (extra gallery views from the mockups).
  const assetKey = typeof uri === "string" && uri.startsWith(ASSET_URI) ? uri.slice(ASSET_URI.length) : "";
  // The catalog photo ships inside the app; use that copy (no network needed) whenever the requested image is that photo.
  const bundled = assetKey ? productImages[assetKey] : (!uri || uri === original?.image) && original?.image === product.image ? productImages[product.id] : undefined;
  const remote = !assetKey && typeof source === "string" && /^https?:\/\//i.test(source) ? { uri: source } : undefined;
  if (failed || (!bundled && !remote)) {
    const tint = product.colors?.find((c) => /^#[0-9a-f]{6}$/i.test(c)) || t.primary;
    return (
      <View accessibilityRole="image" accessibilityLabel={product.name} style={[{ width: "100%", height: "100%", backgroundColor: `${tint}26`, alignItems: "center", justifyContent: "center" }, style]}>
        {product.emoji ? <Txt style={{ fontSize: 58, textAlign: "center", lineHeight: 70 }}>{product.emoji}</Txt> : <ShoppingBag color={t.muted} size={38} />}
        {product.emoji ? null : <Txt style={{ fontSize: 11, color: t.muted, textAlign: "center" }}>{tr("صورة غير متاحة")}</Txt>}
      </View>
    );
  }
  if (bundled && cutoutImages.has(assetKey || product.id)) {
    // Mockup cut-outs: show the whole product with some breathing room, on white in both themes because
    // their soft floor shadows are white.
    return (
      <View style={[{ width: "100%", height: "100%", padding: "8%", backgroundColor: "#FFFFFF" }, style]}>
        <Image accessibilityLabel={product.name} source={bundled} onError={() => setFailedSource(sourceKey)} contentFit="contain" cachePolicy="memory-disk" recyclingKey={sourceKey} style={{ width: "100%", height: "100%" }} />
      </View>
    );
  }
  // expo-image decodes at the size shown and keeps a memory and disk cache, so long product lists scroll without
  // re-decoding full-size photos or downloading them again.
  return <Image accessibilityLabel={product.name} source={bundled || remote} onError={() => setFailedSource(sourceKey)} contentFit="cover" cachePolicy="memory-disk" recyclingKey={sourceKey} transition={120} style={[{ width: "100%", height: "100%" }, style]} />;
}

export function ProductCard({ product, width, reason }: { product: Product; width: number | `${number}%`; reason?: string }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const { favorites, toggleFavorite, addToCart, cart, branchStock } = useStore();
  const money = useMoney();
  const { t: tr } = useI18n();
  const outOfStock = typeof product.stock === "number" && product.stock <= 0;
  const inBranch = branchStock ? branchStock[product.id] ?? 0 : null;
  const liked = favorites.includes(product.id);
  const discount = product.oldPrice && product.oldPrice > product.price ? Math.round((1 - product.price / product.oldPrice) * 100) : 0;
  const approx = money.approx(product.price);
  return (
    <View style={[s.card, { width }]} testID={`product-card-${product.id}`}>
      <View style={s.photo}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${tr("تفاصيل")} ${product.name}`} onPress={() => router.push(`/product/${product.id}`)} style={{ flex: 1 }}>
          <ProductImage product={product} />
        </Pressable>
        <Pressable testID={`favorite-${product.id}`} accessibilityRole="button" accessibilityLabel={liked ? `${tr("إزالة من المفضلة")} ${product.name}` : `${tr("حفظ في المفضلة")} ${product.name}`} aria-selected={liked} onPress={() => toggleFavorite(product.id)} style={s.heart}>
          <Heart color={liked ? t.orange : t.ink} fill={liked ? t.orange : "transparent"} size={17} />
        </Pressable>
        {product.flash ? (
          <View style={[s.badge, { backgroundColor: t.orange }]}><Zap size={11} color={t.onAccent} fill={t.onAccent} /><Txt weight="bold" style={{ color: t.onAccent, fontSize: 10 }}>{tr("خاطف")}</Txt></View>
        ) : discount ? (
          <View style={[s.badge, { backgroundColor: t.primary }]}><Txt weight="bold" style={{ color: t.onPrimary, fontSize: 10 }}>-{discount}%</Txt></View>
        ) : product.badge ? (
          <View style={[s.badge, { backgroundColor: t.paper }]}><Txt weight="bold" style={{ color: t.primary, fontSize: 10 }}>{product.badge}</Txt></View>
        ) : null}
      </View>
      <View style={{ padding: 12, gap: 4, flex: 1 }}>
        <Txt weight="bold" numberOfLines={2} style={{ fontSize: 14, lineHeight: 21, minHeight: 42 }}>{product.name}</Txt>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 4 }}>
          {product.rating ? <><Star size={12} color={t.warning} fill={t.warning} /><Txt style={{ fontSize: 11, color: t.muted }}>{product.rating}</Txt></> : null}
          <Txt numberOfLines={1} style={{ fontSize: 11, color: t.muted, flex: 1 }}>{product.unit || product.subtitle}</Txt>
        </View>
        {reason ? <Txt style={{ fontSize: 11, color: t.primary }} numberOfLines={1}>✨ {tr(reason)}</Txt> : null}
        {inBranch !== null ? <Txt style={{ fontSize: 11, color: inBranch > 0 ? t.success : t.danger }}>{inBranch > 0 ? tr("متوفر في الفرع: {n}", { n: inBranch }) : tr("غير متوفر في هذا الفرع")}</Txt> : null}
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row-reverse", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
          <View style={{ flex: 1 }}>
            <Txt weight="extra" style={{ color: t.orange, fontSize: 16 }}>{money.format(product.price)}</Txt>
            {product.oldPrice && product.oldPrice > product.price ? <Txt style={{ fontSize: 11, color: t.muted, textDecorationLine: "line-through" }}>{money.format(product.oldPrice)}</Txt> : null}
            {approx ? <Txt style={{ fontSize: 10, color: t.muted }}>{approx}</Txt> : null}
          </View>
          <Pressable testID={`add-${product.id}`} accessibilityRole="button" accessibilityLabel={outOfStock ? `${tr("غير متوفر")} ${product.name}` : `${tr("أضف إلى السلة")} ${product.name}`} disabled={outOfStock} onPress={() => (product.hasVariants ? router.push(`/product/${product.id}`) : addToCart(product.id))} style={[s.add, outOfStock ? { backgroundColor: t.line } : null]}>
            <Plus size={18} color={outOfStock ? t.muted : t.onPrimary} />
            {cart[product.id] ? <View style={s.count}><Txt style={{ fontSize: 10, color: t.onAccent, textAlign: "center" }}>{cart[product.id]}</Txt></View> : null}
          </Pressable>
        </View>
        {outOfStock ? <Txt weight="bold" style={{ fontSize: 11, color: t.danger }}>{tr("نفد من المخزون")}</Txt> : null}
      </View>
    </View>
  );
}
// A compact horizontal card for rows of suggestions (home extras, "bought together").
export function MiniProductCard({ product, width }: { product: Product; width: number | `${number}%` }) {
  const { colors: t } = useTheme();
  const { addToCart } = useStore();
  const money = useMoney();
  const { t: tr } = useI18n();
  const out = typeof product.stock === "number" && product.stock <= 0;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={tr("تفاصيل {name}", { name: product.name })} onPress={() => router.push(`/product/${product.id}`)} testID={`mini-${product.id}`}
      style={{ width, flexDirection: "row-reverse", gap: 10, padding: 10, borderRadius: 18, borderWidth: 1, borderColor: t.line, backgroundColor: t.paper, minHeight: 120 }}>
      <View style={{ width: "42%", height: 100 }}><ProductImage product={product} /></View>
      <View style={{ flex: 1, justifyContent: "space-between" }}>
        <View style={{ gap: 2 }}>
          <Txt weight="bold" numberOfLines={2} style={{ fontSize: 14 }}>{product.name}</Txt>
          <Txt weight="bold" style={{ fontSize: 14, color: t.primary }}>{money.format(product.price)}</Txt>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={tr("أضف {name} إلى السلة", { name: product.name })} disabled={out} testID={`mini-add-${product.id}`}
          onPress={() => (product.hasVariants ? router.push(`/product/${product.id}`) : addToCart(product.id))}
          style={{ alignSelf: "flex-start", width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: t.primary, opacity: out ? 0.4 : 1 }}>
          <Plus size={20} color={t.onPrimary} strokeWidth={2.6} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  card: { backgroundColor: t.paper, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: t.line, minHeight: 290 },
  photo: { height: 150, backgroundColor: t.imageBackground },
  heart: { position: "absolute", top: 10, left: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: t.paper, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 10, right: 10, flexDirection: "row-reverse", alignItems: "center", gap: 3, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  add: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.primary, alignItems: "center", justifyContent: "center" },
  count: { position: "absolute", top: -4, left: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.orange, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
});
