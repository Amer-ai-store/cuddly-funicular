// The top of the home screen in the Rafiq design: pick a companion (Nira, Orion or Silk), a stage that switches
// between "the floating market" (departments around the shopper's character) and "from my location" (a real map of
// the store's branches), and the companion's panel with suggestions, intents and a request box.
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, ArrowRight, MessageCircle, Map as MapIcon } from "lucide-react-native";
import { Txt } from "../ui";
import { Mascot } from "../Robot";
import { CompanionFace } from "./marks";
import { FloatingMarket, type MarketStore } from "./FloatingMarket";
import StoresMap from "./StoresMap";
import { NearbyStores } from "./NearbyStores";
import { ProductTile } from "./ProductTile";
import { SocialLinks } from "./SocialLinks";
import { CompanionPicker } from "./CompanionPicker";
import { INTENTS, findIntent, formatDistance, productsForIntent, type CompanionId } from "../../lib/rafiq";
import { useCompanion } from "../../lib/useCompanion";
import { useNearby } from "../../lib/useNearby";
import { useStore } from "../../lib/store";
import { useI18n } from "../../lib/i18n";
import { useTheme } from "../../lib/theme";
import { categoryName, useCategories } from "../../lib/catalog";
import { FEATURED_CATEGORIES } from "../../lib/designAssets";
import type { Product } from "../../data/products";

const STAGE = 300;
type Mode = "market" | "location";

export function RafiqHero() {
  const { colors: t, fonts } = useTheme();
  const { t: tr, lang, isRTL } = useI18n();
  const store = useStore();
  const categories = useCategories();
  const nearby = useNearby();
  const { id: companionId, companion, choose } = useCompanion();
  const [mode, setMode] = useState<Mode>("market");
  const [reply, setReply] = useState<{ text: string; products: Product[] } | null>(null);
  const [ask, setAsk] = useState("");
  const pick = (id: CompanionId) => { choose(id); setReply(null); };
  const switchMode = (next: Mode) => { setMode(next); setReply(null); };

  // The four pavilions: the store's featured departments first, then the rest, with their real names.
  const stores = useMemo<MarketStore[]>(() => {
    const ordered = [...FEATURED_CATEGORIES.flatMap((key) => categories.filter((c) => c.id === key)), ...categories.filter((c) => !FEATURED_CATEGORIES.includes(c.id))];
    return ordered.slice(0, 4).map((c) => ({ id: c.id, name: categoryName(c, lang), nameEn: c.nameEn || c.id, color: c.color }));
  }, [categories, lang]);

  const nearest = nearby.branches[0];
  const idle = mode === "market"
    ? tr(companion.hello)
    : !nearby.branches.length
      ? tr("لم يحدد المتجر مواقع فروعه على الخريطة بعد.")
      : nearby.status === "located" && nearest && nearest.km !== null
        ? tr("هذا موقعك. حولك {n} من فروعنا، أقربها {name} على بعد {d}.", { n: nearby.branches.length, name: nearest.name, d: formatDistance(nearest.km, lang) })
        : tr("حدّد موقعك أولًا، ثم أرتّب لك الفروع القريبة وما يتوفر فيها.");
  const message = reply?.text || idle;
  const products = reply?.products || [];

  const runIntent = (text: string) => {
    const intent = findIntent(text) || INTENTS.find((i) => i.label === text) || null;
    if (!intent) return false;
    const picked = productsForIntent(intent, store.products);
    setReply({ text: picked.length ? tr(intent.reply) : tr("لم أجد ما يناسب هذا الطلب في المتجر الآن. جرّب طلبًا آخر أو اسأل المساعد."), products: picked });
    return true;
  };
  const submit = () => {
    const text = ask.trim();
    if (!text) return;
    setAsk("");
    if (!runIntent(text)) router.navigate({ pathname: "/assistant", params: { q: text } });
  };
  const chooseBranch = (id: string) => {
    const branch = nearby.branches.find((b) => b.id === id);
    if (!branch) return;
    const go = tr(companion.go, { place: branch.name });
    setReply({ text: branch.eta !== null ? `${go} ${tr("التوصيل لمنزلك خلال {n} دقيقة تقريبًا.", { n: branch.eta })}` : go, products: [] });
  };
  const onAdded = () => setReply((r) => ({ text: tr(companion.added), products: r?.products || products }));
  const Send = isRTL ? ArrowLeft : ArrowRight;

  return (
    <View testID="rafiq-hero" style={{ gap: 12, marginBottom: 8 }}>
      <CompanionPicker value={companionId} onChange={pick} />

      <View style={{ borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: t.line, backgroundColor: "#070A12" }}>
        {mode === "market" ? (
          <FloatingMarket stores={stores} height={STAGE} onEnter={(id) => router.navigate({ pathname: "/explore", params: { category: id } })}>
            <Mascot size={110} bubble="top" message={tr(companion.short)} />
          </FloatingMarket>
        ) : nearby.branches.length ? (
          <StoresMap home={nearby.home} branches={nearby.branches} selectedId={nearby.selectedId} onSelect={(id) => { nearby.select(id); chooseBranch(id); }} height={STAGE} dark />
        ) : (
          <View style={{ height: STAGE, alignItems: "center", justifyContent: "center", padding: 24 }}><Txt style={{ color: "#9BA4BA", textAlign: "center" }}>{tr("لم يحدد المتجر مواقع فروعه على الخريطة بعد.")}</Txt></View>
        )}
        <View pointerEvents="box-none" style={{ position: "absolute", top: 10, left: 0, right: 0, alignItems: "center" }}>
          <View accessibilityRole="radiogroup" accessibilityLabel={tr("طريقة التسوّق")} style={{ flexDirection: "row-reverse", padding: 3, borderRadius: 12, backgroundColor: "rgba(9,13,24,0.82)", borderWidth: 1, borderColor: "rgba(214,224,255,0.18)" }}>
            {([["market", "السوق العائم"], ["location", "من موقعي"]] as const).map(([key, label]) => {
              const on = mode === key;
              return (
                <Pressable key={key} testID={`mode-${key}`} accessibilityRole="radio" aria-checked={on} accessibilityLabel={tr(label)} onPress={() => switchMode(key)}
                  style={{ height: 34, paddingHorizontal: 14, borderRadius: 9, justifyContent: "center", backgroundColor: on ? "#E8ECF5" : "transparent" }}>
                  <Txt weight="medium" style={{ fontSize: 12, color: on ? "#070A12" : "#9BA4BA" }}>{tr(label)}</Txt>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View testID="concierge" style={{ gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: t.line, backgroundColor: t.paper }}>
        <View style={{ flexDirection: "row-reverse", gap: 12, alignItems: "flex-start", minHeight: 54 }} accessibilityLiveRegion="polite">
          <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#0D1220", borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" }}><CompanionFace id={companionId} size={34} /></View>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}>
              <Txt weight="extra" style={{ fontSize: 13 }}>{tr(companion.name)}</Txt>
              <View style={{ paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, borderWidth: 1, borderColor: t.orange }}><Txt style={{ fontSize: 10, color: t.orange }}>{tr("ذكاء اصطناعي")}</Txt></View>
            </View>
            <Txt testID="concierge-text" style={{ fontSize: 14, lineHeight: 24 }}>{message}</Txt>
          </View>
        </View>

        {products.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} testID="concierge-products">
            {products.map((p) => <ProductTile key={p.id} product={p} prefix="concierge" onAdded={onAdded} />)}
          </ScrollView>
        ) : null}

        {mode === "market" ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row-reverse", gap: 8 }}>
            {INTENTS.map((intent) => (
              <Pressable key={intent.id} testID={`intent-${intent.id}`} accessibilityRole="button" accessibilityLabel={tr(intent.label)} onPress={() => runIntent(intent.label)}
                style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: pressed ? t.orange : t.line, justifyContent: "center" })}>
                <Txt style={{ fontSize: 13 }}>{tr(intent.label)}</Txt>
                <Txt style={{ fontSize: 10, color: t.muted }}>{tr(intent.sub)}</Txt>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <NearbyStores nearby={nearby} map="none" onChoose={chooseBranch} onAdded={onAdded} />
        )}

        <View style={{ flexDirection: "row-reverse", gap: 8 }}>
          <TextInput testID="concierge-ask" accessibilityLabel={tr("اكتب طلبك لرفيقك")} value={ask} onChangeText={setAsk} onSubmitEditing={submit} returnKeyType="send" placeholder={tr("اطلب من رفيقك ما تحتاج…")} placeholderTextColor={t.muted}
            style={{ flex: 1, minWidth: 0, height: 48, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.background, color: t.ink, fontFamily: fonts.medium, fontSize: 15, textAlign: isRTL ? "right" : "left" }} />
          <Pressable testID="concierge-send" accessibilityRole="button" accessibilityLabel={tr("أرسل")} onPress={submit} style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: t.orange, alignItems: "center", justifyContent: "center" }}>
            <Send size={20} color={t.onAccent} />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row-reverse", gap: 8 }}>
            <Pressable testID="open-companion" accessibilityRole="link" accessibilityLabel={tr("محادثة كاملة مع رفيقك")} onPress={() => router.navigate("/companion")} style={({ pressed }) => ({ flexDirection: "row-reverse", alignItems: "center", gap: 6, minHeight: 38, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: t.line, backgroundColor: pressed ? t.secondary : "transparent" })}>
              <MessageCircle size={15} color={t.primary} /><Txt weight="medium" style={{ fontSize: 12, color: t.primary }}>{tr("محادثة كاملة")}</Txt>
            </Pressable>
            <Pressable testID="open-nearby" accessibilityRole="link" accessibilityLabel={tr("المتاجر القريبة")} onPress={() => router.navigate("/nearby")} style={({ pressed }) => ({ flexDirection: "row-reverse", alignItems: "center", gap: 6, minHeight: 38, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: t.line, backgroundColor: pressed ? t.secondary : "transparent" })}>
              <MapIcon size={15} color={t.primary} /><Txt weight="medium" style={{ fontSize: 12, color: t.primary }}>{tr("المتاجر القريبة")}</Txt>
            </Pressable>
          </View>
          <SocialLinks compact />
        </View>
      </View>
    </View>
  );
}
