// Shared building blocks for the G14 screens, in the reference design language.
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import { Txt } from "../ui";
import { Chip, IconCircle, type IconType } from "../design/kit";
import { ProductImage } from "../ProductCard";
import { formatPrice, type Product } from "../../data/products";
import { useStore } from "../../lib/store";
import { track } from "../../lib/analytics";
import { Palette, useTheme, useThemedStyles } from "../../lib/theme";

export function useMoney() {
  const { settings } = useStore();
  return (v: number | null | undefined) => (v == null ? "—" : formatPrice(v, settings.currency));
}

export function DemoChip({ show, label = "تجريبي" }: { show: boolean; label?: string }) {
  return show ? <Chip label={label} tone="demo" /> : null;
}

export type Tool = { key: string; title: string; detail: string; icon: IconType; href: Href; tint?: string };
export function ToolGrid({ tools }: { tools: Tool[] }) {
  const s = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  return (
    <View style={s.grid}>
      {tools.map((tool) => (
        <Pressable key={tool.key} testID={`tool-${tool.key}`} accessibilityRole="button" accessibilityLabel={`${tool.title}: ${tool.detail}`} onPress={() => { track("open_tool"); router.push(tool.href); }} style={({ pressed }) => [s.tile, pressed && { opacity: 0.85 }]}>
          <IconCircle icon={tool.icon} tint={tool.tint || t.orange} bg={t.orangeSoft} size={46} />
          <Txt weight="bold" numberOfLines={1} style={{ fontSize: 15, color: t.title, marginTop: 8, textAlign: "right" }}>{tool.title}</Txt>
          <Txt numberOfLines={2} style={{ fontSize: 12, color: t.muted, textAlign: "right", lineHeight: 18 }}>{tool.detail}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

export function ProductRow({ product, right, onPress, testID }: { product: Product; right?: React.ReactNode; onPress?: () => void; testID?: string }) {
  const s = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const money = useMoney();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={product.name} onPress={onPress || (() => router.push(`/product/${product.id}`))} style={s.row}>
      <View style={s.thumb}><ProductImage product={product} /></View>
      <View style={{ flex: 1, alignItems: "flex-end", gap: 2 }}>
        <Txt weight="bold" numberOfLines={2} style={{ color: t.title, fontSize: 15 }}>{product.name}</Txt>
        <Txt weight="bold" style={{ color: t.orange }}>{money(product.price)}{product.oldPrice && product.oldPrice > product.price ? <Txt style={{ color: t.mutedSoft, textDecorationLine: "line-through", fontSize: 12 }}>  {money(product.oldPrice)}</Txt> : null}</Txt>
      </View>
      {right}
    </Pressable>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const s = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  return (
    <View style={s.stat} accessibilityLabel={`${label}: ${value}`}>
      <Txt weight="extra" numberOfLines={1} style={{ fontSize: 20, color: tone === "good" ? t.green : tone === "bad" ? t.danger : t.title }}>{value}</Txt>
      <Txt numberOfLines={1} style={{ fontSize: 12, color: t.muted }}>{label}</Txt>
    </View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  grid: { flexDirection: "row-reverse", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  tile: { width: "48.5%", minHeight: 132, borderRadius: 22, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, padding: 14, alignItems: "flex-end" },
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 10, paddingVertical: 10 },
  thumb: { width: 56, height: 64, borderRadius: 14, backgroundColor: t.field, overflow: "hidden" },
  stat: { flex: 1, minWidth: "30%", borderRadius: 18, backgroundColor: t.field, padding: 12, alignItems: "flex-end" },
});
