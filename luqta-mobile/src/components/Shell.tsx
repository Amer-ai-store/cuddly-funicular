import React from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Bell, Bot, Compass, MapPin, Gift, Heart, House, ListChecks, LayoutDashboard, Package, Refrigerator, ShoppingBag, Sparkles, Store, UserRound, Headset, Wallet, Wand2 } from "lucide-react-native";
import { router, usePathname, type Href } from "expo-router";
import { Palette, useTheme, useThemedStyles } from "../lib/theme";
import { useStore } from "../lib/store";
import { useSession } from "../lib/session";
import { useI18n } from "../lib/i18n";
import { Txt } from "./ui";
import { designAssets } from "../lib/designAssets";
import { Mascot } from "./Robot";
import { RafiqMark } from "./rafiq/marks";
import type { RobotMotion } from "../lib/robot";

const tabs = [
  { href: "/", label: "الرئيسية", icon: House },
  { href: "/explore", label: "اكتشف", icon: Compass },
  { href: "/cart", label: "السلة", icon: ShoppingBag },
  { href: "/profile", label: "حسابي", icon: UserRound },
] as const;
const more = [
  { href: "/assistant", label: "تسوق بالمحادثة", icon: Sparkles },
  { href: "/smart-tools", label: "الأدوات الذكية", icon: Wand2 },
  { href: "/companion", label: "رفيقك الذكي", icon: Bot },
  { href: "/nearby", label: "المتاجر القريبة", icon: MapPin },
  { href: "/favorites", label: "اختياراتك", icon: Heart },
  { href: "/orders", label: "طلباتي", icon: Package },
  { href: "/lists", label: "قوائمي", icon: ListChecks },
  { href: "/offers", label: "العروض", icon: Gift },
  { href: "/pantry", label: "مخزن البيت", icon: Refrigerator },
  { href: "/rewards", label: "مكافآتي", icon: Wallet },
  { href: "/support", label: "الدعم", icon: Headset },
] as const;

export function Logo({ small = false }: { small?: boolean }) {
  const { colors: t, design } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={tr("لُقطة — الرئيسية")} onPress={() => router.navigate("/")} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10 }}>
      {design === "rafiq"
        ? <View testID="brand-logo"><RafiqMark size={small ? 38 : 46} leaf={t.orange} gold={t.primary} /></View>
        : <Image testID="brand-logo" source={designAssets.logoMark} accessibilityIgnoresInvertColors resizeMode="contain" style={{ width: small ? 38 : 46, height: small ? 38 : 46 }} />}
      <View>
        <Txt weight="extra" style={{ fontSize: small ? 22 : 28, lineHeight: small ? 28 : 34 }}>{tr("لُقطة")}</Txt>
        <Txt weight="bold" style={{ fontSize: small ? 10 : 11, color: t.muted, letterSpacing: 0.4 }}>Amer AI Store</Txt>
      </View>
    </Pressable>
  );
}

export function Shell({ children, title, subtitle, search = false, robot, robotMotion, scroll = true, back = false, testID, header, side, footer }: {
  children: React.ReactNode; title: string; subtitle?: string; search?: boolean;
  robot?: boolean | string; robotMotion?: RobotMotion; scroll?: boolean; back?: boolean; testID?: string;
  /** Extra content above the page title (a back row, a hero). */ header?: React.ReactNode;
  /** A control shown beside the title, in place of the character. */ side?: React.ReactNode;
  /** A bar kept at the bottom of the screen, outside the scrolling content. */ footer?: React.ReactNode;
}) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const desktop = width >= 950;
  const path = usePathname();
  const store = useStore();
  const { user } = useSession();
  const { t: tr } = useI18n();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const content = (
    <View style={[s.content, { paddingHorizontal: desktop ? 36 : 18 }, scroll ? null : { flex: 1 }]}>
      {header ?? null}
      {title ? (
        <View style={s.pageHeading}>
          <View style={{ flex: 1, gap: 4 }}>
            {back ? <Pressable accessibilityRole="button" accessibilityLabel={tr("رجوع")} onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} style={{ alignSelf: "flex-end", minHeight: 32 }}><Txt weight="bold" style={{ color: t.primary, fontSize: 13 }}>{tr("رجوع")}</Txt></Pressable> : null}
            <Txt accessibilityRole="header" weight="extra" style={{ fontSize: desktop ? 30 : 26, lineHeight: desktop ? 40 : 36 }}>{tr(title)}</Txt>
            {subtitle ? <Txt style={{ color: t.muted, lineHeight: 22 }}>{tr(subtitle)}</Txt> : null}
          </View>
          {robot ? <Mascot size={desktop ? 92 : 74} motion={robotMotion} message={typeof robot === "string" ? robot : undefined} bubble={typeof robot === "string" ? "top" : "none"} /> : side ?? null}
        </View>
      ) : null}
      {search ? (
        <Pressable testID="shell-search" accessibilityRole="search" accessibilityLabel={tr("ابحث عن منتج")} onPress={() => router.navigate("/explore")} style={s.searchBar}>
          <Txt style={{ color: t.muted, flex: 1 }}>{tr("ابحث عن منتج، قسم أو وصفة…")}</Txt>
        </Pressable>
      ) : null}
      {(path === "/" || path === "/explore" || path === "/cart" || path.startsWith("/product/")) && store.catalogStatus !== "connected" ? (
        <View style={s.connectionBanner} testID="catalog-banner">
          <View style={{ flex: 1, gap: 4 }}>
            <Txt weight="bold" style={{ fontSize: 13 }}>{tr(store.catalogStatus === "loading" ? "جارٍ مزامنة الكتالوج…" : store.catalogStatus === "offline" ? "الخادم غير متاح حاليًا" : "كتالوج نموذجي")}</Txt>
            <Txt style={{ color: t.muted, fontSize: 12, lineHeight: 20 }}>{tr(store.catalogStatus === "offline" ? "نعرض آخر نسخة متاحة. أعد الاتصال قبل إتمام الطلب." : store.catalogStatus === "loading" ? "نسترجع المنتجات والكميات من قاعدة بيانات المتجر." : "اربط خادم المتجر للوصول إلى المنتجات والمخزون والطلبات المشتركة.")}</Txt>
          </View>
          <Pressable accessibilityRole="button" style={s.bannerAction} onPress={() => router.navigate("/connection")}><Txt weight="bold" style={{ color: t.primary, fontSize: 12 }}>{tr("إعداد الاتصال")}</Txt></Pressable>
          {store.catalogStatus === "offline" ? <Pressable accessibilityRole="button" style={s.bannerAction} onPress={() => { void store.refreshCatalog(); }}><Txt weight="bold" style={{ color: t.primary, fontSize: 12 }}>{tr("إعادة المحاولة")}</Txt></Pressable> : null}
        </View>
      ) : null}
      {children}
      <Txt style={{ color: t.muted, fontSize: 11, textAlign: "center", marginTop: 28 }}>{tr(store.catalogStatus === "connected" ? "لُقطة · متصل بخادم المتجر" : "لُقطة · صُنعت لتجعل اختيارك أسهل")}</Txt>
    </View>
  );
  return (
    <SafeAreaView testID={testID} style={s.safe} edges={["top", "left", "right"]}>
      <View style={s.frame}>
        {desktop ? (
          <View style={s.sidebar}>
            <Logo />
            <View style={{ gap: 4, marginTop: 26 }}>
              {[...tabs, ...more].map((item) => {
                const on = active(item.href);
                return (
                  <Pressable key={item.href} accessibilityRole="button" aria-selected={on} accessibilityLabel={tr(item.label)} onPress={() => router.navigate(item.href as Href)} style={[s.navItem, on ? { backgroundColor: t.primarySoft } : null]}>
                    <item.icon size={19} color={on ? t.primary : t.muted} />
                    <Txt weight={on ? "bold" : "medium"} style={{ flex: 1, color: on ? t.primary : t.ink, fontSize: 14 }}>{tr(item.label)}</Txt>
                    {item.href === "/cart" && store.cartCount ? <View style={s.badge}><Txt style={{ color: t.onAccent, fontSize: 10, textAlign: "center" }}>{store.cartCount}</Txt></View> : null}
                  </Pressable>
                );
              })}
              {user?.role === "admin" ? (
                <Pressable accessibilityRole="button" onPress={() => router.navigate("/admin")} style={[s.navItem, active("/admin") ? { backgroundColor: t.primarySoft } : null]}>
                  <LayoutDashboard size={19} color={t.primary} /><Txt weight="bold" style={{ flex: 1, color: t.primary }}>{tr("لوحة القيادة")}</Txt>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" onPress={() => router.navigate("/vendor")} style={s.navItem}><Store size={19} color={t.muted} /><Txt weight="medium" style={{ flex: 1, fontSize: 14 }}>{tr("لوحة التاجر")}</Txt></Pressable>
            </View>
            <View style={{ flex: 1 }} />
            <Mascot size={86} bubble="top" message="اضغطني!" />
          </View>
        ) : null}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.main}>
          <View style={[s.header, { paddingHorizontal: desktop ? 36 : 16 }]}>
            {desktop ? <View style={{ flex: 1 }} /> : <Logo small />}
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}>
              <Pressable testID="robot-pill" accessibilityRole="button" accessibilityLabel={tr("تسوق بالمحادثة مع لُقطي")} onPress={() => router.navigate("/assistant")} style={s.pill}>
                <Bot size={17} color={t.onPrimary} />
                <Txt weight="bold" style={{ color: t.onPrimary, fontSize: 13 }}>{tr("لُقطي")}</Txt>
              </Pressable>
              <Pressable testID="bell" accessibilityRole="button" accessibilityLabel={tr("الإشعارات")} onPress={() => router.navigate("/notifications")} style={s.iconButton}>
                <Bell size={19} color={t.ink} />
                {store.unreadCount ? <View style={[s.badge, { position: "absolute", top: -3, right: -3 }]}><Txt style={{ color: t.onAccent, fontSize: 10, textAlign: "center" }}>{store.unreadCount}</Txt></View> : null}
              </Pressable>
            </View>
          </View>
          {scroll ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">{content}</ScrollView> : <View style={{ flex: 1 }}>{content}</View>}
          {footer ? <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: desktop ? 36 : 16, paddingTop: 6 }}>{footer}</View> : null}
          {!desktop ? (
            <SafeAreaView edges={["bottom"]} style={s.bottomWrap}>
              <View style={s.bottomNav} accessibilityRole="tablist">
                {tabs.map((item) => {
                  const on = active(item.href);
                  return (
                    <Pressable key={item.href} testID={`tab-${item.href === "/" ? "home" : item.href.slice(1)}`} accessibilityRole="tab" accessibilityLabel={item.href === "/cart" && store.cartCount ? `${tr(item.label)}، ${store.cartCount}` : tr(item.label)} aria-selected={on} onPress={() => router.navigate(item.href)} style={s.bottomItem}>
                      <View style={[s.tabPill, on ? { backgroundColor: t.primarySoft } : null]}>
                        <item.icon size={21} color={on ? t.primary : t.muted} strokeWidth={on ? 2.4 : 2} />
                        {on ? <Txt weight="bold" style={{ fontSize: 12, color: t.primary }}>{tr(item.label)}</Txt> : null}
                        {item.href === "/cart" && store.cartCount ? <View style={[s.badge, { position: "absolute", top: -4, right: on ? -6 : 2 }]}><Txt style={{ color: t.onAccent, fontSize: 10, textAlign: "center" }}>{store.cartCount}</Txt></View> : null}
                      </View>
                      {!on ? <Txt weight="medium" style={{ fontSize: 11, color: t.muted, marginTop: 2, textAlign: "center" }}>{tr(item.label)}</Txt> : null}
                    </Pressable>
                  );
                })}
              </View>
            </SafeAreaView>
          ) : null}
        </KeyboardAvoidingView>
      </View>
      {store.toast ? <View testID="toast" accessibilityLiveRegion="polite" style={s.toast}><Txt weight="bold" style={{ color: t.onToast, textAlign: "center", fontSize: 14 }}>{tr(store.toast)}</Txt></View> : null}
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.background },
  frame: { flex: 1, flexDirection: "row-reverse" },
  sidebar: { width: 236, backgroundColor: t.paper, borderLeftWidth: 1, borderLeftColor: t.line, padding: 22, paddingTop: 26 },
  navItem: { flexDirection: "row-reverse", alignItems: "center", gap: 12, minHeight: 44, borderRadius: 14, paddingHorizontal: 12 },
  main: { flex: 1 },
  header: { minHeight: 64, flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", paddingTop: 6 },
  pill: { flexDirection: "row-reverse", alignItems: "center", gap: 6, backgroundColor: t.primary, minHeight: 40, paddingHorizontal: 14, borderRadius: 999 },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: t.paper, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" },
  content: { width: "100%", maxWidth: 1180, alignSelf: "center", paddingTop: 6 },
  pageHeading: { flexDirection: "row-reverse", alignItems: "center", gap: 12, marginBottom: 14, minHeight: 70 },
  searchBar: { minHeight: 54, borderRadius: 18, backgroundColor: t.paper, borderWidth: 1, borderColor: t.line, paddingHorizontal: 16, flexDirection: "row-reverse", alignItems: "center", marginBottom: 14 },
  connectionBanner: { flexDirection: "row-reverse", alignItems: "center", gap: 10, padding: 14, borderRadius: 20, backgroundColor: t.paper, borderWidth: 1, borderColor: t.line, marginBottom: 16, flexWrap: "wrap" },
  bannerAction: { minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: t.primarySoft, justifyContent: "center" },
  bottomWrap: { backgroundColor: t.paper, borderTopWidth: 1, borderTopColor: t.line },
  bottomNav: { flexDirection: "row-reverse", justifyContent: "space-around", alignItems: "center", paddingVertical: 8, paddingHorizontal: 8 },
  bottomItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 52 },
  tabPill: { flexDirection: "row-reverse", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 38, borderRadius: 19 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.orange, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  toast: { position: "absolute", left: 20, right: 20, bottom: 96, backgroundColor: t.toast, borderRadius: 18, padding: 14, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 18, elevation: 6 },
});
