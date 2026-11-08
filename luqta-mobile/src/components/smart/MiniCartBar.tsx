// Sticky mini-cart footer (G16): item count + subtotal + "عرض السلة" when the cart has items.
import React from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { ShoppingBasket } from "lucide-react-native";
import { Txt } from "../ui";
import { formatPrice } from "../../data/products";
import { useStore } from "../../lib/store";
import { useTheme } from "../../lib/theme";

export function MiniCartBar() {
  const { colors: t } = useTheme();
  const { cartCount, subtotal, settings } = useStore();
  if (!cartCount) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`عرض السلة: ${cartCount} منتج بقيمة ${formatPrice(subtotal, settings.currency)}`} testID="mini-cart" onPress={() => router.navigate("/cart")}
      style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, backgroundColor: t.orange, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 6 }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" }}><Txt weight="bold" style={{ color: t.onAccent }}>{cartCount > 99 ? "99+" : cartCount}</Txt></View>
      <Txt weight="bold" style={{ flex: 1, color: t.onAccent, fontSize: 16 }}>عرض السلة</Txt>
      <Txt weight="bold" style={{ color: t.onAccent, fontSize: 16 }}>{formatPrice(subtotal, settings.currency)}</Txt>
      <ShoppingBasket size={22} color={t.onAccent} />
    </Pressable>
  );
}
