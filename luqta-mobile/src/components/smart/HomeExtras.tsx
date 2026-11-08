// Home additions from the Aura app (placed below the reference layout so the design is
// unchanged): stories, campaigns, flash sale, smart-tool strip, promo video, check-in nudge.
import React, { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { CalendarCheck, ChevronLeft, Star, Timer } from "lucide-react-native";
import { Txt } from "../ui";
import { Card, SectionHeader } from "../design/kit";
import { MiniProductCard } from "../ProductCard";
import { SMART_GROUPS } from "./tools";
import { YouTubeEmbed } from "./YouTubeEmbed";
import { useCountdown } from "./ProductExtras";
import { useSession } from "../../lib/session";
import { useStore } from "../../lib/store";
import { useRemote } from "../../lib/useRemote";
import type { Campaign, MediaPost, RewardsProfile } from "../../lib/smart";
import { useTheme } from "../../lib/theme";
import { TOOL_FLAGS, useFlags } from "../../lib/flags";
import { api } from "../../lib/api";
import type { Product } from "../../data/products";

export function StoriesRow() {
  const { colors: t } = useTheme();
  const { data } = useRemote<{ posts: MediaPost[] }>("/media?kind=story");
  if (!data?.posts.length) return null;
  return (
    <View style={{ marginTop: 16 }} testID="home-stories">
      <SectionHeader title="قصص اليوم" action="الكل" onPress={() => router.push("/reels")} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, flexDirection: "row-reverse" }}>
        {data.posts.map((p) => (
          <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`قصة: ${p.title}`} onPress={() => router.push("/reels")} style={{ alignItems: "center", width: 74 }}>
            <View style={{ width: 70, height: 70, borderRadius: 35, borderWidth: 3, borderColor: t.orange, padding: 2 }}><Image source={{ uri: p.mediaUrl }} style={{ flex: 1, borderRadius: 32 }} /></View>
            <Txt numberOfLines={1} style={{ fontSize: 12, color: t.ink, marginTop: 4 }}>{p.title}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function CampaignStrip() {
  const { colors: t } = useTheme();
  const { data } = useRemote<{ campaigns: Campaign[] }>("/campaigns");
  if (!data?.campaigns.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, flexDirection: "row-reverse", paddingVertical: 4 }} style={{ marginTop: 16 }} testID="home-campaigns">
      {data.campaigns.map((c) => (
        <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.title} onPress={() => (c.productId ? router.push(`/product/${c.productId}`) : router.push({ pathname: "/explore", params: c.category ? { category: c.category } : {} }))}
          style={{ width: 280, height: 130, borderRadius: 24, overflow: "hidden", backgroundColor: t.orange, justifyContent: "flex-end" }}>
          {c.image ? <Image source={{ uri: c.image }} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="cover" /> : null}
          <View style={{ padding: 14, backgroundColor: c.image ? "rgba(19,0,80,0.45)" : "transparent" }}>
            <Txt weight="extra" style={{ color: "#fff", fontSize: 19 }}>{c.title}</Txt>
            {c.subtitle ? <Txt numberOfLines={1} style={{ color: "#fff", fontSize: 13 }}>{c.subtitle}</Txt> : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function FlashSale() {
  const { colors: t } = useTheme();
  const { products } = useStore();
  const [now] = useState(() => Date.now());
  const deals = useMemo(() => products.filter((p) => p.oldPrice && p.oldPrice > p.price && p.offerEndsAt && Date.parse(p.offerEndsAt) > now).sort((a, b) => Date.parse(a.offerEndsAt as string) - Date.parse(b.offerEndsAt as string)).slice(0, 8), [products, now]);
  const left = useCountdown(deals[0]?.offerEndsAt);
  if (!deals.length || !left) return null;
  return (
    <Card style={{ marginTop: 16 }} testID="home-flash">
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Timer size={24} color={t.orange} />
        <Txt weight="extra" style={{ flex: 1, fontSize: 19, color: t.title }}>عروض البرق</Txt>
        <View style={{ backgroundColor: t.orange, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}><Txt weight="bold" style={{ color: t.onAccent }}>{left}</Txt></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, flexDirection: "row-reverse" }}>
        {deals.map((p) => <MiniProductCard key={p.id} product={p} width={140} />)}
      </ScrollView>
    </Card>
  );
}

export function SmartStrip() {
  const { colors: t } = useTheme();
  const flags = useFlags();
  const tools = SMART_GROUPS.flatMap((g) => g.tools).filter((x) => ["basket-optimizer", "lens", "market-pulse", "vendors", "lists", "game", "reels"].includes(x.key) && (!TOOL_FLAGS[x.key] || flags[TOOL_FLAGS[x.key]]));
  return (
    <View style={{ marginTop: 16 }} testID="home-smart">
      <SectionHeader title="أدوات لُقطة الذكية" action="كل الأدوات" onPress={() => router.push("/smart-tools")} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, flexDirection: "row-reverse" }}>
        {tools.map((tool) => (
          <Pressable key={tool.key} accessibilityRole="button" accessibilityLabel={tool.title} onPress={() => router.push(tool.href)} style={{ width: 104, borderRadius: 20, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, padding: 12, alignItems: "center", gap: 6 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.orangeSoft, alignItems: "center", justifyContent: "center" }}><tool.icon size={22} color={t.orange} /></View>
            <Txt weight="bold" numberOfLines={2} style={{ fontSize: 13, color: t.title, textAlign: "center" }}>{tool.title}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const youtubeId = (url?: string | null) => (url ? /(?:v=|youtu\.be\/)([\w-]{6,20})/.exec(url)?.[1] : undefined);
export function PromoVideo() {
  const { settings } = useStore();
  const id = youtubeId(settings.storefront?.promoVideoUrl);
  if (!id) return null;
  return (
    <View style={{ marginTop: 16 }} testID="home-promo">
      <SectionHeader title="شاهد العرض" />
      <View style={{ aspectRatio: 16 / 9, borderRadius: 20, overflow: "hidden", backgroundColor: "#000" }}>
        <YouTubeEmbed id={id} />
      </View>
    </View>
  );
}

export function CheckinNudge() {
  const { colors: t } = useTheme();
  const { user } = useSession();
  const { data } = useRemote<RewardsProfile>(user ? "/rewards/profile" : null, { auth: true });
  if (!user || !data || data.checkedInToday) return null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push("/rewards")} testID="home-checkin">
      <Card style={{ marginTop: 16, flexDirection: "row-reverse", alignItems: "center", gap: 10, backgroundColor: t.orangeSoft }}>
        <CalendarCheck size={30} color={t.orange} />
        <View style={{ flex: 1, alignItems: "flex-end" }}><Txt weight="bold" style={{ color: t.title }}>سجّل حضورك اليوم</Txt><Txt style={{ color: t.muted, fontSize: 13 }}>+{data.nextCheckinPoints} نقطة · سلسلتك {data.streak} يوم</Txt></View>
        <ChevronLeft size={22} color={t.orange} />
      </Card>
    </Pressable>
  );
}

export function CollectionRows() {
  const { products } = useStore();
  const { data } = useRemote<{ collections: { id: string; title: string; subtitle: string | null; products: Product[] }[] }>("/collections");
  if (!data?.collections.length) return null;
  return (
    <>
      {data.collections.slice(0, 4).map((c) => (
        <View key={c.id} style={{ marginTop: 16 }} testID={`collection-${c.id}`}>
          <SectionHeader title={c.title} action="عرض الكل" onPress={() => router.push(`/collection/${c.id}`)} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, flexDirection: "row-reverse" }}>
            {c.products.slice(0, 10).map((p) => <MiniProductCard key={p.id} product={products.find((x) => x.id === p.id) || p} width={140} />)}
          </ScrollView>
        </View>
      ))}
    </>
  );
}

/** "قيّم طلبك" — latest delivered order without feedback (G16). */
export function FeedbackPrompt() {
  const { colors: t } = useTheme();
  const { user } = useSession();
  const { data, setData } = useRemote<{ order: { id: string; total: number; items: number } | null }>(user ? "/orders/feedback/pending" : null, { auth: true });
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const tags = ["سريع", "مغلّف جيدًا", "سائق لطيف", "منتجات طازجة", "تأخر", "صنف ناقص"];
  const [picked, setPicked] = useState<string[]>([]);
  if (!user || !data?.order) return null;
  const order = data.order;
  async function send() {
    setBusy(true);
    try { await api.post(`/orders/${order.id}/feedback`, { rating, tags: picked }); setData({ order: null }); } catch { /* keep the card */ } finally { setBusy(false); }
  }
  return (
    <Card style={{ marginTop: 16, gap: 8 }} testID="feedback-prompt">
      <Txt weight="bold" style={{ color: t.title, fontSize: 17 }}>كيف كان طلبك {order.id}؟</Txt>
      <View style={{ flexDirection: "row-reverse", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} من 5`} onPress={() => setRating(n)} hitSlop={6}><Star size={30} color={t.orange} fill={n <= rating ? t.orange : "none"} /></Pressable>)}
      </View>
      {rating ? (
        <>
          <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 }}>
            {tags.map((tag) => { const on = picked.includes(tag); return <Pressable key={tag} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setPicked(on ? picked.filter((x) => x !== tag) : [...picked, tag])} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? t.orange : t.field }}><Txt style={{ color: on ? t.onAccent : t.ink, fontSize: 13 }}>{tag}</Txt></Pressable>; })}
          </View>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send()} style={{ alignSelf: "flex-start", backgroundColor: t.orange, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, opacity: busy ? 0.6 : 1 }}><Txt weight="bold" style={{ color: t.onAccent }}>إرسال التقييم</Txt></Pressable>
        </>
      ) : null}
    </Card>
  );
}

export function HomeExtras() {
  return (<><FeedbackPrompt /><CheckinNudge /><StoriesRow /><CampaignStrip /><FlashSale /><CollectionRows /><SmartStrip /><PromoVideo /></>);
}
