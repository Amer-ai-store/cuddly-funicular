// "فيديوهات التسوق" (shoppable short videos) + "القصص" — vertical feed, like, product CTA.
import React, { useCallback, useState } from "react";
import { FlatList, Image, Pressable, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Heart, ShoppingCart, X } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Txt } from "../components/ui";
import { CTA, InfoNote, LoadingBlock, Segmented } from "../components/design/kit";
import { useMoney } from "../components/smart/Bits";
import { VideoSurface } from "../components/smart/VideoSurface";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { useRemote } from "../lib/useRemote";
import type { MediaPost } from "../lib/smart";
import { useTheme } from "../lib/theme";

export default function Reels() {
  const { colors: t } = useTheme();
  const { height, width } = useWindowDimensions();
  const money = useMoney();
  const { products, addToCart, notify } = useStore();
  const { user } = useSession();
  const [kind, setKind] = useState<"video" | "story">("video");
  const [index, setIndex] = useState(0);
  const { data, setData, loading, demo } = useRemote<{ posts: MediaPost[] }>(`/media?kind=${kind}`, { demo: () => ({ posts: [] }) });
  const posts = data?.posts || [];
  const pageH = height - 120;
  const onViewable = useCallback(({ viewableItems }: { viewableItems: { index: number | null; item: MediaPost }[] }) => { const v = viewableItems[0]; if (v?.index != null) { setIndex(v.index); void api.post(`/media/${v.item.id}/view`).catch(() => {}); } }, []);
  async function like(p: MediaPost) {
    if (!user) { router.push("/login"); return; }
    try { const r = await api.post<{ post: MediaPost }>(`/media/${p.id}/like`); setData((d) => (d ? { posts: d.posts.map((x) => (x.id === p.id ? r.post : x)) } : d)); } catch (e) { notify(e instanceof Error ? e.message : "تعذّر"); }
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#130050" }} edges={["top"]}>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, padding: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="إغلاق" onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} hitSlop={10}><X size={28} color="#fff" /></Pressable>
        <View style={{ flex: 1 }}><Segmented value={kind} onChange={(v) => { setKind(v); setIndex(0); }} options={[{ value: "video", label: "فيديوهات" }, { value: "story", label: "قصص" }]} testID="reels-kind" /></View>
      </View>
      {loading && !data ? <LoadingBlock /> : !posts.length ? (
        <View style={{ padding: 20, gap: 12 }}>
          <Txt weight="bold" style={{ color: "#fff", fontSize: 20, textAlign: "center" }}>لا توجد {kind === "video" ? "فيديوهات" : "قصص"} منشورة بعد</Txt>
          <InfoNote text={demo ? "يتطلب ربط خادم المتجر؛ تنشر الإدارة المقاطع من «النمو والمحتوى» في لوحة الإدارة." : "تنشر الإدارة المقاطع والقصص من «النمو والمحتوى» في لوحة الإدارة."} />
          <CTA title="تصفح المنتجات" onPress={() => router.navigate("/explore")} />
        </View>
      ) : (
        <FlatList data={posts} keyExtractor={(p) => p.id} pagingEnabled showsVerticalScrollIndicator={false} testID="reels-feed"
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
          renderItem={({ item, index: i }) => {
            const p = item.productId ? products.find((x) => x.id === item.productId) : undefined;
            const isVideo = item.kind === "video";
            return (
              <View style={{ height: pageH, width }}>
                {isVideo && i === index ? <VideoSurface url={item.mediaUrl} poster={item.posterUrl} /> : <Image source={{ uri: isVideo ? item.posterUrl || undefined : item.mediaUrl }} style={{ flex: 1, backgroundColor: "#000" }} resizeMode="cover" accessibilityLabel={item.title} />}
                <View style={{ position: "absolute", left: 12, right: 12, bottom: 18, gap: 10 }}>
                  <Txt weight="extra" style={{ color: "#fff", fontSize: 20, textShadowColor: "#000", textShadowRadius: 6 }}>{item.title}</Txt>
                  <View style={{ flexDirection: "row-reverse", gap: 8, alignItems: "center" }}>
                    {p ? <Pressable accessibilityRole="button" accessibilityLabel={`أضف ${p.name} للسلة`} onPress={() => { addToCart(p.id); notify(`أُضيف ${p.name} للسلة`); }} style={{ flex: 1, flexDirection: "row-reverse", alignItems: "center", gap: 8, backgroundColor: t.orange, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 16 }}>
                      <ShoppingCart size={20} color="#fff" /><Txt weight="bold" numberOfLines={1} style={{ color: "#fff", flex: 1 }}>{p.name} · {money(p.price)}</Txt></Pressable> : <View style={{ flex: 1 }} />}
                    {p ? <Pressable accessibilityRole="button" onPress={() => router.push(`/product/${p.id}`)} style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 999, paddingVertical: 12, paddingHorizontal: 14 }}><Txt weight="bold" style={{ color: "#fff" }}>التفاصيل</Txt></Pressable> : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={item.liked ? "إلغاء الإعجاب" : "إعجاب"} onPress={() => void like(item)} style={{ alignItems: "center" }}><Heart size={30} color="#fff" fill={item.liked ? t.orange : "none"} /><Txt style={{ color: "#fff", fontSize: 12 }}>{item.likes}</Txt></Pressable>
                  </View>
                </View>
              </View>
            );
          }} />
      )}
    </SafeAreaView>
  );
}
