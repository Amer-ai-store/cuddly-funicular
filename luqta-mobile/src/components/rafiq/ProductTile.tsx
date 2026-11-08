// The concierge's product card from the Rafiq design (156 px wide): a picture, the name, a short line and an outlined
// "add to cart" button. Used by the companion's suggestions and by "available near you".
import React from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { ProductImage } from "../ProductCard";
import { Txt } from "../ui";
import { useStore } from "../../lib/store";
import { useMoney } from "../../lib/money";
import { useI18n } from "../../lib/i18n";
import { useTheme } from "../../lib/theme";
import type { Product } from "../../data/products";

export function ProductTile({ product, prefix, onAdded }: { product: Product; prefix: string; onAdded?: (product: Product) => void }) {
  const { colors: t } = useTheme();
  const { addToCart, cart } = useStore();
  const money = useMoney();
  const { t: tr } = useI18n();
  const out = typeof product.stock === "number" && product.stock <= 0;
  const inCart = (cart[product.id] || 0) > 0;
  const add = () => {
    if (product.hasVariants) { router.push(`/product/${product.id}`); return; }
    addToCart(product.id);
    onAdded?.(product);
  };
  return (
    <View testID={`${prefix}-${product.id}`} style={{ width: 156, gap: 6, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.secondary }}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr("تفاصيل {name}", { name: product.name })} onPress={() => router.push(`/product/${product.id}`)} style={{ gap: 6 }}>
        <View style={{ height: 72, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: t.line, backgroundColor: t.imageBackground }}><ProductImage product={product} /></View>
        <Txt weight="bold" numberOfLines={1} style={{ fontSize: 13 }}>{product.name}</Txt>
        <Txt numberOfLines={2} style={{ fontSize: 11, color: t.muted, lineHeight: 17, minHeight: 34 }}>{product.subtitle || product.description}</Txt>
        <Txt weight="bold" style={{ fontSize: 13, color: t.primary }}>{money.format(product.price)}</Txt>
      </Pressable>
      <Pressable testID={`${prefix}-add-${product.id}`} accessibilityRole="button" accessibilityLabel={tr("أضف {name} إلى السلة", { name: product.name })} disabled={out} onPress={add}
        style={({ pressed }) => ({ height: 36, borderRadius: 10, borderWidth: 1, borderColor: out ? t.line : t.orange, backgroundColor: pressed ? t.orange : "transparent", alignItems: "center", justifyContent: "center", opacity: out ? 0.6 : 1 })}>
        {({ pressed }) => <Txt weight="bold" style={{ fontSize: 12, color: out ? t.muted : pressed ? t.onAccent : t.orange }}>{tr(out ? "غير متوفر" : inCart ? "أضف واحدة أخرى" : "أضف للسلة")}</Txt>}
      </Pressable>
    </View>
  );
}
