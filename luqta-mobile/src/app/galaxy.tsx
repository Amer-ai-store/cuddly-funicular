// "مجرة المتجر" (Cosmic Commerce, WP-13/#8): an optional view where store departments orbit
// like planets. Lightweight 2D (no 3D load), every planet is a labelled button, rotation stops
// with reduced motion or the simple interface, and a plain list below works for everyone.
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Shell } from "../components/Shell";
import { Txt } from "../components/ui";
import { SmallButton } from "../components/design/kit";
import { categories } from "../data/products";
import { useStore } from "../lib/store";
import { useTheme } from "../lib/theme";

const EMOJI: Record<string, string> = { food: "🥗", electronics: "🎧", fashion: "👟", home: "🛋️", beauty: "🧴", sports: "⚽", kids: "🧸", toys: "🧸", other: "🛍️" };
const PLANET = ["#7C3AED", "#0E7490", "#DB2777", "#059669", "#D97706", "#2563EB", "#9333EA", "#DC2626"];
export default function Galaxy() {
  const { colors: t } = useTheme(); const simple = false;
  const { products } = useStore();
  const { width } = useWindowDimensions();
  const [reduce, setReduce] = useState(false);
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {}); }, []);
  const still = reduce || simple;
  useEffect(() => {
    if (still) { spin.stopAnimation(); return; }
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 60000, easing: Easing.linear, useNativeDriver: true }));
    loop.start(); return () => loop.stop();
  }, [still, spin]);
  const size = Math.min(width - 32, 380), r = size / 2 - 38;
  const cats = categories.filter((c) => products.some((p) => p.category === c.id)).slice(0, 8);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const counter = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });
  const open = (id: string) => router.push({ pathname: "/explore", params: { category: id } });
  return (
    <Shell title="مجرة المتجر" subtitle="الأقسام كمدارات — المس كوكبًا لتدخل قسمه">
      <View style={{ alignSelf: "center", width: size, height: size, borderRadius: size / 2, backgroundColor: "#0B1026", overflow: "hidden" }} testID="galaxy">
        {Array.from({ length: 40 }).map((_, i) => <View key={i} style={{ position: "absolute", left: (i * 97) % size, top: (i * 53 + i * i) % size, width: i % 5 ? 2 : 3, height: i % 5 ? 2 : 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.7)" }} />)}
        <View style={{ position: "absolute", left: size / 2 - r, top: size / 2 - r, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 1, borderColor: "rgba(103,232,249,0.35)" }} />
        <View style={{ position: "absolute", left: size / 2 - 42, top: size / 2 - 42, width: 84, height: 84, borderRadius: 42, backgroundColor: t.orange, alignItems: "center", justifyContent: "center" }}>
          <Txt weight="extra" style={{ color: "#fff", fontSize: 22, textAlign: "center" }}>لُقطة</Txt>
        </View>
        <Animated.View style={{ position: "absolute", width: size, height: size, transform: [{ rotate }] }}>
          {cats.map((c, i) => {
            const a = (i / cats.length) * Math.PI * 2, x = size / 2 + r * Math.cos(a) - 32, y = size / 2 + r * Math.sin(a) - 32;
            return (
              <Animated.View key={c.id} style={{ position: "absolute", left: x, top: y, transform: [{ rotate: counter }] }}>
                <Pressable accessibilityRole="button" accessibilityLabel={`قسم ${c.label}`} testID={`planet-${c.id}`} onPress={() => open(c.id)}
                  style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: PLANET[i % PLANET.length], alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "rgba(255,255,255,0.5)" }}>
                  <Txt style={{ fontSize: 22 }}>{EMOJI[c.icon] || "🪐"}</Txt>
                  <Txt weight="bold" numberOfLines={1} style={{ color: "#fff", fontSize: 10, textAlign: "center" }}>{c.label.split(" ")[0]}</Txt>
                </Pressable>
              </Animated.View>
            );
          })}
        </Animated.View>
      </View>
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        {cats.map((c) => <SmallButton key={c.id} title={c.label} tone="outline" onPress={() => open(c.id)} />)}
      </View>
      <Txt style={{ color: t.muted, fontSize: 13, marginTop: 10 }}>{still ? "الحركة متوقفة (تقليل الحركة أو الواجهة البسيطة)." : "تدور المجرة ببطء؛ فعّل «تقليل الحركة» لإيقافها."}</Txt>
    </Shell>
  );
}
