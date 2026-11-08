import React, { useCallback, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Camera, Mic, Search, CalendarCheck, ArrowLeft, Sparkles, X } from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Shell } from "../components/Shell";
import { Button, Card, Chip, Row, SectionTitle, Txt } from "../components/ui";
import { ProductCard } from "../components/ProductCard";
import { ProductGrid } from "../components/ProductGrid";
import { Mascot } from "../components/Robot";
import { Countdown } from "../components/Countdown";
import { CollectionRows, PromoVideo, SmartStrip, StoriesRow } from "../components/smart/HomeExtras";
import { CategoryIcon } from "../components/CategoryIcon";
import { RafiqHero } from "../components/rafiq/RafiqHero";
import { NearbyStores } from "../components/rafiq/NearbyStores";
import { SocialLinks } from "../components/rafiq/SocialLinks";
import { RafiqMark } from "../components/rafiq/marks";
import { useNearby } from "../lib/useNearby";
import { UpdateBanner } from "../components/UpdateBanner";
import { EMPTY_PASSPORT, readLocalPassport, rankByLocalInterests, type LocalPassport } from "../lib/localPassport";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { categoryName, useCategories } from "../lib/catalog";
import { categoryArt, FEATURED_CATEGORIES } from "../lib/designAssets";
import { useRobot } from "../lib/robot";
import type { Product } from "../data/products";

type Campaign = { id: string; title: string; subtitle: string; color: string; link: string; cta: string };
type Deal = { id: string; productId: string; product: Product; price: number; endsAt: string; remaining: number | null };
const DESIGN_HINT_KEY = "luqta-design-hint-v1";

// Classic design: branches near the shopper, with the map behind a button so the home screen stays light.
function ClassicNearby() {
  const nearby = useNearby();
  if (!nearby.branches.length && !nearby.loading) return null;
  return (
    <>
      <SectionTitle title="قريب منك" subtitle="الفروع الأقرب إليك وما يتوفر فيها الآن" action="عرض الكل" onPress={() => router.navigate("/nearby")} />
      <NearbyStores nearby={nearby} map="toggle" />
      <View style={{ marginTop: 12 }}><SocialLinks /></View>
    </>
  );
}

// A one-time invitation on the classic home to try the Rafiq design; the choice also lives in Language & appearance.
function DesignHint() {
  const { setDesign } = useTheme();
  const { t: tr } = useI18n();
  const [hidden, setHidden] = useState(true);
  React.useEffect(() => {
    let active = true;
    AsyncStorage.getItem(DESIGN_HINT_KEY).then((v) => { if (active) setHidden(v === "dismissed"); }).catch(() => { if (active) setHidden(false); });
    return () => { active = false; };
  }, []);
  if (hidden) return null;
  const dismiss = () => { setHidden(true); void AsyncStorage.setItem(DESIGN_HINT_KEY, "dismissed").catch(() => {}); };
  return (
    <View testID="design-hint" style={{ marginTop: 14, flexDirection: "row-reverse", alignItems: "center", gap: 12, padding: 14, borderRadius: 20, backgroundColor: "#0D1220" }}>
      <RafiqMark size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="extra" style={{ color: "#E8ECF5", fontSize: 15 }}>{tr("جديد: تصميم «رفيق»")}</Txt>
        <Txt style={{ color: "#9BA4BA", fontSize: 12, lineHeight: 19 }}>{tr("سوق عائم ورفيق ذكي وخريطة للفروع القريبة. يمكنك العودة للتصميم الحالي في أي وقت.")}</Txt>
      </View>
      <Pressable testID="try-rafiq" accessibilityRole="button" accessibilityLabel={tr("جرّب تصميم رفيق")} onPress={() => { setDesign("rafiq"); dismiss(); }} style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 12, backgroundColor: "#B4F28A", justifyContent: "center" }}>
        <Txt weight="bold" style={{ color: "#0F1F08", fontSize: 13 }}>{tr("جرّبه")}</Txt>
      </Pressable>
      <Pressable testID="dismiss-design-hint" accessibilityRole="button" accessibilityLabel={tr("إخفاء")} onPress={dismiss} hitSlop={10}><X size={18} color="#9BA4BA" /></Pressable>
    </View>
  );
}

export default function Home() {
  const { colors: t, design, fonts } = useTheme();
  const { t: tr, lang, isRTL } = useI18n();
  const store = useStore();
  const { user } = useSession();
  const robot = useRobot();
  const { width } = useWindowDimensions();
  const categories = useCategories();
  const [query, setQuery] = useState("");
  // A guest's device-local passport (name, region, interests) shapes the greeting and the suggestions (PR #161).
  const [passport, setPassport] = useState<LocalPassport>(EMPTY_PASSPORT);
  useFocusEffect(useCallback(() => {
    let active = true;
    readLocalPassport().then((value) => { if (active) setPassport(value); }).catch(() => {});
    return () => { active = false; };
  }, []));
  const campaigns = useApi<{ campaigns: Campaign[] }>("/campaigns");
  const deals = useApi<{ serverTime: string; deals: Deal[] }>("/flash-deals");
  const recent = store.recentIds.slice(0, 10).join(",");
  const recommendations = useApi<{ personalized: boolean; products: (Product & { reason: string })[] }>(`/recommendations?limit=8${recent ? `&recent=${encodeURIComponent(recent)}` : ""}`);
  const prefs = useApi<{ preferences: { onboarded: boolean; interests: string[] } }>("/me/preferences", { needsUser: true });
  const checkin = useApi<{ checkedInToday: boolean; streak: number; nextReward: number }>("/rewards/check-in", { needsUser: true });
  const [interests, setInterests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const columns = width >= 900 ? 4 : 2;
  const recommended = !user && passport.categories.length
    ? rankByLocalInterests(store.products, passport.categories).slice(0, 8).map((p) => ({ ...p, reason: passport.categories.includes(p.category) ? "من اهتماماتك على هذا الجهاز" : "الأعلى تقييمًا" }))
    : recommendations.data?.products?.length ? recommendations.data.products : [...store.products].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 8).map((p) => ({ ...p, reason: "الأعلى تقييمًا" }));
  const recentlyViewed = useMemo(() => store.recentIds.map((id) => store.products.find((p) => p.id === id)).filter((p): p is Product => !!p).slice(0, 10), [store.recentIds, store.products]);
  const featured = useMemo(() => store.products.filter((p) => (p.stock ?? 1) > 0).slice(0, 8), [store.products]);
  const submit = () => router.navigate({ pathname: "/explore", params: query.trim() ? { q: query.trim() } : {} });
  const saveInterests = async () => {
    setBusy(true);
    try { await api.patch("/me/preferences", { interests, onboarded: true }); prefs.reload(); recommendations.reload(); robot.react("hello", tr("رتّبت لك المتجر حسب ذوقك ✨")); }
    catch { store.notify("تعذر حفظ الاهتمامات"); } finally { setBusy(false); }
  };
  const doCheckin = async () => {
    try {
      const result = await api.post<{ awarded: number; streak: number }>("/rewards/check-in", {});
      checkin.reload(); robot.react("checkin", tr("+{n} نقاط! حضورك {d} يوم متتالي", { n: result.awarded, d: result.streak }));
    } catch { store.notify("تعذر تسجيل الحضور"); }
  };
  const Arrow = ArrowLeft;
  return (
    <Shell title="" testID="home">
      <UpdateBanner />
      {design === "rafiq" ? <RafiqHero /> : (
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt style={{ color: t.muted }}>{user ? tr("أهلًا {name} 👋", { name: user.name.split(" ")[0] }) : passport.displayName ? tr("أهلًا {name} 👋", { name: passport.displayName.split(" ")[0] }) : tr("أهلًا بك 👋")}</Txt>
            <Txt accessibilityRole="header" weight="extra" style={{ fontSize: 30, lineHeight: 42 }}>{tr("شو بدك اليوم؟")}</Txt>
          </View>
          <Mascot size={92} bubble="top" message={tr("اسألني أي شي!")} />
        </View>
      )}
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, backgroundColor: t.paper, borderRadius: 20, borderWidth: 1, borderColor: t.line, paddingHorizontal: 8, minHeight: 56 }}>
        <Search size={19} color={t.muted} />
        <TextInput testID="home-search" accessibilityLabel={tr("ابحث عن منتج")} value={query} onChangeText={setQuery} onSubmitEditing={submit} returnKeyType="search" placeholder={tr("ابحث عن منتج، قسم أو وصفة…")} placeholderTextColor={t.muted} style={{ flex: 1, minWidth: 0, minHeight: 50, color: t.ink, fontFamily: fonts.medium, fontSize: 15, textAlign: isRTL ? "right" : "left" }} />
        <Pressable testID="home-voice" accessibilityRole="button" accessibilityLabel={tr("بحث صوتي")} onPress={() => router.navigate({ pathname: "/explore", params: { mode: "voice" } })} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.primarySoft, alignItems: "center", justifyContent: "center" }}><Mic size={18} color={t.primary} /></Pressable>
        <Pressable testID="home-camera" accessibilityRole="button" accessibilityLabel={tr("بحث بالصورة")} onPress={() => router.navigate({ pathname: "/explore", params: { mode: "image" } })} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.orangeSoft, alignItems: "center", justifyContent: "center" }}><Camera size={18} color={t.orange} /></Pressable>
      </View>

      {design === "classic" ? <DesignHint /> : null}

      {!user ? <Pressable testID="home-passport" accessibilityRole="button" onPress={() => router.push("/passport")}
        style={{ marginTop: 14, backgroundColor: t.primarySoft, borderColor: t.primary, borderWidth: 1, padding: 14, borderRadius: 20, gap: 4 }}>
        <Txt weight="extra" style={{ color: t.primary, fontSize: 16 }}>{tr("✦ جوازك العالمي — تسوق على ذوقك")}</Txt>
        <Txt style={{ color: t.muted, fontSize: 12 }}>{passport.categories.length ? tr("تم اختيار {n} اهتمامات محلية", { n: passport.categories.length }) : tr("خصّص تجربة التصفح دون حساب أو خادم")}</Txt>
      </Pressable> : null}

      {user && prefs.data && !prefs.data.preferences.onboarded ? (
        <Card style={{ marginTop: 16, gap: 10 }} tone="soft" testID="onboarding">
          <Row><Sparkles size={18} color={t.primary} /><Txt weight="extra" style={{ fontSize: 17, flex: 1 }}>{tr("خلّينا نعرف ذوقك")}</Txt></Row>
          <Txt style={{ color: t.muted, fontSize: 13 }}>{tr("اختر اهتماماتك لنرتب لك المتجر والتوصيات.")}</Txt>
          <Row wrap>{categories.map((c) => <Chip key={c.id} testID={`interest-${c.id}`} label={categoryName(c, lang)} active={interests.includes(c.id)} onPress={() => setInterests((x) => (x.includes(c.id) ? x.filter((v) => v !== c.id) : [...x, c.id]))} />)}</Row>
          <Button title={tr("احفظ اهتماماتي")} testID="save-interests" busy={busy} disabled={!interests.length} onPress={saveInterests} tone="primary" />
        </Card>
      ) : null}

      {user && checkin.data ? (
        <Card style={{ marginTop: 14 }} testID="checkin-card">
          <Row>
            <View style={{ width: 46, height: 46, borderRadius: 16, backgroundColor: t.warningSoft, alignItems: "center", justifyContent: "center" }}><CalendarCheck size={22} color={t.warning} /></View>
            <View style={{ flex: 1 }}>
              <Txt weight="bold">{checkin.data.checkedInToday ? tr("سجّلت حضورك اليوم ✅") : tr("سجّل حضورك اليومي")}</Txt>
              <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("سلسلة {n} يوم · المكافأة القادمة {p} نقاط", { n: checkin.data.streak, p: checkin.data.nextReward })}</Txt>
            </View>
            {!checkin.data.checkedInToday ? <Button title={tr("سجّل")} testID="checkin" onPress={doCheckin} style={{ minHeight: 42, paddingVertical: 8 }} /> : null}
          </Row>
        </Card>
      ) : null}

      <SectionTitle title="الأقسام" action="كل الأقسام" onPress={() => router.navigate("/explore")} />
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>
        {[...FEATURED_CATEGORIES.flatMap((key) => categories.filter((c) => c.id === key)), ...categories.filter((c) => !FEATURED_CATEGORIES.includes(c.id))].slice(0, 4).map((c) => (
          <Pressable key={c.id} testID={`category-${c.id}`} accessibilityRole="button" accessibilityLabel={categoryName(c, lang)} onPress={() => router.navigate({ pathname: "/explore", params: { category: c.id } })} style={{ width: "23%", alignItems: "center", gap: 6 }}>
            <View style={{ width: "100%", aspectRatio: 1, maxWidth: 86, borderRadius: 24, backgroundColor: `${c.color}22`, alignItems: "center", justifyContent: "center" }}>{categoryArt[c.id] ? <Image testID={`category-art-${c.id}`} source={categoryArt[c.id]} accessibilityIgnoresInvertColors resizeMode="contain" style={{ width: "70%", height: "70%" }} /> : <CategoryIcon name={c.icon} size={28} color={c.color} />}</View>
            <Txt weight="bold" numberOfLines={1} style={{ fontSize: 12, textAlign: "center" }}>{categoryName(c, lang)}</Txt>
          </Pressable>
        ))}
      </View>

      {design === "classic" ? <ClassicNearby /> : null}

      {campaigns.data?.campaigns?.length ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ marginTop: 20 }} contentContainerStyle={{ gap: 12 }} testID="campaigns">
          {campaigns.data.campaigns.map((c) => (
            <Pressable key={c.id} testID={`campaign-${c.id}`} accessibilityRole="button" accessibilityLabel={c.title} onPress={() => router.navigate(c.link as never)} style={{ width: Math.min(width - 36, 560), minHeight: 132, borderRadius: 26, backgroundColor: c.color, padding: 18, justifyContent: "space-between" }}>
              <View style={{ gap: 4 }}>
                <Txt weight="extra" style={{ color: "#FFFFFF", fontSize: 21 }}>{c.title}</Txt>
                <Txt style={{ color: "#FFFFFFDD", fontSize: 13 }}>{c.subtitle}</Txt>
              </View>
              <View style={{ alignSelf: "flex-end", flexDirection: "row-reverse", alignItems: "center", gap: 6, backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
                <Txt weight="bold" style={{ color: c.color, fontSize: 13 }}>{c.cta}</Txt><Arrow size={14} color={c.color} />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <StoriesRow />
      <SmartStrip />

      {deals.data?.deals?.length ? (
        <>
          <SectionTitle title="عروض خاطفة ⚡" subtitle="تنتهي قريبًا — الكمية محدودة" action="كل العروض" onPress={() => router.navigate("/offers")} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }} testID="flash-deals">
            {deals.data.deals.map((d) => (
              <View key={d.id} style={{ width: 186, gap: 8 }}>
                <Countdown endsAt={d.endsAt} serverTime={deals.data?.serverTime} onEnd={deals.reload} />
                <ProductCard product={{ ...d.product, price: d.price }} width={186} />
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}

      <SectionTitle title="مختارة لك" subtitle={recommendations.data?.personalized ? "حسب اهتماماتك ومشترياتك" : "الأكثر طلبًا الآن"} />
      <ProductGrid items={recommended.slice(0, columns * 2)} reasons={Object.fromEntries(recommended.map((p) => [p.id, p.reason]))} />

      <CollectionRows />
      <PromoVideo />

      {recentlyViewed.length ? (
        <>
          <SectionTitle title="شاهدتها مؤخرًا" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }} testID="recently-viewed">
            {recentlyViewed.map((p) => <ProductCard key={p.id} product={p} width={170} />)}
          </ScrollView>
        </>
      ) : null}

      <SectionTitle title="منتجات مميزة" action="عرض الكل" onPress={() => router.navigate("/explore")} />
      <ProductGrid items={featured} />
      <Button title={tr("ابدأ التسوق")} testID="start-shopping" onPress={() => router.navigate("/explore")} style={{ marginTop: 22 }} />
    </Shell>
  );
}
