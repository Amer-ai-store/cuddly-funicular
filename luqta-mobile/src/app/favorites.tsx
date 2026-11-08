import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, Share, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { CheckSquare, ListChecks, Share2, ShoppingCart, Square, X } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { ProductImage } from "../components/ProductCard";
import { Button, Card, EmptyState, Notice, Row, Tabs, Txt } from "../components/ui";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";

type ListSummary = { id: string; name: string; kind: string; itemCount: number; checkedCount: number; estimatedTotal: number };

export default function Choices() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const params = useLocalSearchParams<{ tab?: string }>();
  const store = useStore();
  const { favorites, products, compareIds, toggleCompare, toggleFavorite, refreshWishlist, wishlistSynced } = store;
  const { user, configured } = useSession();
  const [tab, setTab] = useState<"favorites" | "compare" | "lists">(params.tab === "compare" || params.tab === "lists" ? params.tab : "favorites");
  const [picked, setPicked] = useState<string[]>([]);
  const lists = useApi<{ lists: ListSummary[] }>("/lists", { needsUser: true });
  useFocusEffect(useCallback(() => { if (user && configured) void refreshWishlist().catch(() => {}); }, [user, configured, refreshWishlist]));
  const saved = products.filter((p) => favorites.includes(p.id));
  const compared = compareIds.map((id) => products.find((p) => p.id === id)).filter((p): p is (typeof products)[number] => !!p);
  const share = () => Share.share({ title: tr("مفضلتي في لُقطة"), message: saved.map((p) => `• ${p.name} — ${money.format(p.price)}`).join("\n") });
  const addPicked = () => { store.addManyToCart(Object.fromEntries(picked.map((id) => [id, 1]))); setPicked([]); };
  const specKeys = [...new Set(compared.flatMap((p) => (p.specs || []).map((s) => s.label)))].slice(0, 6);
  return (
    <Shell title="اختياراتك" subtitle="المفضلة والمقارنة وقوائم التسوق في مكان واحد" testID="choices">
      <Tabs testID="choice-tabs" value={tab} onChange={setTab} tabs={[{ id: "favorites", label: "المفضلة", count: saved.length }, { id: "compare", label: "المقارنة", count: compared.length }, { id: "lists", label: "القوائم", count: lists.data?.lists.length }]} />
      {tab === "favorites" ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          {user && !wishlistSynced && configured ? <Notice text="جارٍ مزامنة المفضلة مع حسابك…" /> : null}
          {saved.length ? <>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt style={{ color: t.muted }}>{tr("اختر منتجات لإضافتها معًا")}</Txt>
              <Pressable testID="share-favorites" accessibilityRole="button" accessibilityLabel={tr("مشاركة المفضلة")} onPress={() => void share()} style={{ padding: 8 }}><Share2 size={18} color={t.primary} /></Pressable>
            </Row>
            {saved.map((p) => {
              const on = picked.includes(p.id);
              return (
                <Card key={p.id} style={{ padding: 10 }} testID={`favorite-row-${p.id}`}>
                  <Row>
                    <Pressable testID={`pick-${p.id}`} accessibilityRole="checkbox" aria-checked={on} accessibilityLabel={p.name} onPress={() => setPicked((x) => (on ? x.filter((v) => v !== p.id) : [...x, p.id]))} style={{ padding: 6 }}>{on ? <CheckSquare size={22} color={t.primary} /> : <Square size={22} color={t.muted} />}</Pressable>
                    <Pressable accessibilityRole="button" onPress={() => router.push(`/product/${p.id}`)} style={{ width: 60, height: 60, borderRadius: 14, overflow: "hidden" }}><ProductImage product={p} /></Pressable>
                    <View style={{ flex: 1 }}><Txt weight="bold" numberOfLines={1}>{p.name}</Txt><Txt weight="extra" style={{ color: t.orange }}>{money.format(p.price)}</Txt></View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${tr("إزالة من المفضلة")} ${p.name}`} onPress={() => toggleFavorite(p.id)} style={{ padding: 8 }}><X size={18} color={t.muted} /></Pressable>
                  </Row>
                </Card>
              );
            })}
            <Button title={tr("أضف المحدد إلى السلة ({n})", { n: picked.length })} testID="add-picked" icon={<ShoppingCart size={17} color={t.onAccent} />} disabled={!picked.length} onPress={addPicked} />
          </> : <EmptyState title="لا توجد مفضلة بعد" detail="اضغط القلب على أي منتج لحفظه هنا." />}
        </View>
      ) : null}
      {tab === "compare" ? (
        compared.length ? (
          <ScrollView horizontal style={{ marginTop: 14 }} contentContainerStyle={{ flexDirection: "row-reverse" }} testID="compare-table">
            <View style={{ width: 110, gap: 0 }}>
              {["", "السعر", "التقييم", "المتوفر", "الوحدة", ...specKeys].map((label, i) => <View key={`${label}-${i}`} style={{ height: i ? 46 : 150, justifyContent: "center", borderBottomWidth: i ? 1 : 0, borderColor: t.line }}><Txt weight="bold" style={{ fontSize: 12, color: t.muted }}>{tr(label)}</Txt></View>)}
            </View>
            {compared.map((p) => (
              <View key={p.id} style={{ width: 170, marginHorizontal: 4, backgroundColor: t.paper, borderRadius: 20, borderWidth: 1, borderColor: t.line, paddingHorizontal: 8 }}>
                <View style={{ height: 150, gap: 6, paddingTop: 8 }}>
                  <View style={{ height: 80, borderRadius: 14, overflow: "hidden" }}><ProductImage product={p} /></View>
                  <Txt weight="bold" numberOfLines={2} style={{ fontSize: 12 }}>{p.name}</Txt>
                </View>
                {[money.format(p.price), p.reviews ? `⭐ ${p.rating}` : "—", String(p.stock ?? "—"), p.unit || p.subtitle || "—", ...specKeys.map((k) => p.specs?.find((s) => s.label === k)?.value || "—")].map((v, i) => <View key={i} style={{ height: 46, justifyContent: "center", borderBottomWidth: 1, borderColor: t.line }}><Txt numberOfLines={2} style={{ fontSize: 12 }}>{v}</Txt></View>)}
                <Row style={{ paddingVertical: 8, justifyContent: "space-between" }}>
                  <Button title={tr("أضف")} onPress={() => store.addToCart(p.id)} style={{ minHeight: 38, paddingVertical: 4, paddingHorizontal: 12 }} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`${tr("إزالة من المقارنة")} ${p.name}`} onPress={() => toggleCompare(p.id)} style={{ padding: 6 }}><X size={16} color={t.muted} /></Pressable>
                </Row>
              </View>
            ))}
          </ScrollView>
        ) : <EmptyState title="لا توجد منتجات للمقارنة" detail="من صفحة المنتج اختر «مقارنة» لتضيف حتى أربعة منتجات." />
      ) : null}
      {tab === "lists" ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          {!user ? <EmptyState title="سجّل الدخول لقوائمك" detail="القوائم محفوظة في حسابك ويمكن مشاركتها مع العائلة." action="تسجيل الدخول" href="/login" /> : <>
            {(lists.data?.lists || []).map((l) => (
              <Card key={l.id} onPress={() => router.push(`/list/${l.id}`)} accessibilityLabel={l.name}>
                <Row><ListChecks size={20} color={t.primary} /><View style={{ flex: 1 }}><Txt weight="bold">{l.name}</Txt><Txt style={{ color: t.muted, fontSize: 12 }}>{tr("{n} عناصر · {c} منجزة", { n: l.itemCount, c: l.checkedCount })}{l.kind === "family" ? ` · ${tr("عائلية")}` : ""}</Txt></View><Txt weight="bold" style={{ color: t.orange }}>{money.format(l.estimatedTotal)}</Txt></Row>
              </Card>
            ))}
            <Button title={tr("إدارة القوائم")} onPress={() => router.push("/lists")} secondary />
          </>}
        </View>
      ) : null}
    </Shell>
  );
}
