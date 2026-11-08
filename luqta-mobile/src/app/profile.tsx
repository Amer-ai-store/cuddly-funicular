import React from "react";
import { View } from "react-native";
import { router, type Href } from "expo-router";
import { Bell, Bot, ChartPie, Wand2, Globe2, Download, Gift, Globe, Headset, CircleQuestionMark as HelpCircle, LayoutDashboard, ListChecks, LogOut, MapPin, Package, PiggyBank, Refrigerator, Server, Share2, ShieldCheck, Store, Trash, Truck, UserRound, Wallet } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Mascot } from "../components/Robot";
import { Badge, Button, Card, ListRow, Row, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";

type Profile = { name: string; email: string; phone: string; avatar: string };
type Rewards = { points: number; redeemablePoints: number };
type Tier = { tier: { id: string; name: string }; next: { name: string; pointsNeeded: number } | null; progress: number };

export default function ProfileScreen() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const money = useMoney();
  const { user, logout, configured } = useSession();
  const store = useStore();
  const profile = useApi<{ profile: Profile }>("/me/profile", { needsUser: true });
  const rewards = useApi<Rewards>("/rewards", { needsUser: true });
  const tier = useApi<Tier>("/rewards/tier", { needsUser: true });
  const vendors = useApi<{ vendors: { id: string; name: string }[] }>("/vendor/me", { needsUser: true });
  const go = (href: Href) => () => router.push(href);
  const icon = (I: typeof Bell) => <I size={19} color={t.primary} />;
  if (!user) return (
    <Shell title="حسابي" subtitle="سجّل الدخول لحفظ عناوينك وطلباتك ونقاطك" testID="profile">
      <Card style={{ alignItems: "center", gap: 12 }}>
        <Mascot size={120} motion="wave" bubble="top" message="أهلًا! خلّينا نتعرّف" interactive={false} />
        <Button title={tr("تسجيل الدخول")} onPress={() => router.push("/login")} style={{ alignSelf: "stretch" }} />
        <Button title={tr("إنشاء حساب")} secondary onPress={() => router.push("/register")} style={{ alignSelf: "stretch" }} />
      </Card>
      <Card style={{ marginTop: 12 }}>
        <ListRow testID="menu-passport-guest" icon={icon(Globe2)} title="جواز التسوق العالمي" detail="منطقة واسم عرض واهتمامات على الجهاز" onPress={go("/passport")} />
        <ListRow icon={icon(Globe)} title="اللغة والمظهر" onPress={go("/appearance")} />
        <ListRow icon={icon(Bot)} title="شخصيتي وحركتها" onPress={go("/robot")} />
        <ListRow icon={icon(Server)} title="اتصال الخادم" onPress={go("/connection")} />
        <ListRow icon={icon(HelpCircle)} title="مركز المساعدة" onPress={go("/help")} />
      </Card>
    </Shell>
  );
  const avatar = profile.data?.profile.avatar || "";
  const emoji = avatar.startsWith("emoji:") ? avatar.slice(6) : "";
  return (
    <Shell title="حسابي" testID="profile">
      <Card tone="primary" style={{ gap: 12 }} testID="profile-card">
        <Row>
          <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: t.paper, alignItems: "center", justifyContent: "center" }}>
            {emoji ? <Txt style={{ fontSize: 30 }}>{emoji}</Txt> : <UserRound size={28} color={t.primary} />}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt weight="extra" style={{ color: t.onPrimary, fontSize: 20 }}>{user.name}</Txt>
            <Txt style={{ color: t.onPrimary, opacity: 0.85, fontSize: 12 }}>{user.email}{profile.data?.profile.phone ? ` · ${profile.data.profile.phone}` : ""}</Txt>
          </View>
          {tier.data ? <Badge label={tr("عضوية {t}", { t: tier.data.tier.name })} tone="warning" /> : null}
        </Row>
        <Button title={tr("تعديل بياناتي")} secondary onPress={go("/account")} style={{ minHeight: 42, paddingVertical: 8 }} />
      </Card>
      <Card style={{ marginTop: 12, gap: 8 }} testID="points-card">
        <Row style={{ justifyContent: "space-between" }}>
          <View>
            <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("نقاطي")}</Txt>
            <Txt weight="extra" style={{ fontSize: 28, color: t.orange }}>{rewards.data?.points ?? 0}</Txt>
            <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("قابل للاستبدال بـ {m}", { m: money.format((rewards.data?.redeemablePoints ?? 0) / 100) })}</Txt>
          </View>
          <Button title={tr("استبدل")} testID="redeem-points" onPress={go("/rewards")} style={{ minHeight: 44, paddingVertical: 8 }} />
        </Row>
        {tier.data?.next ? <>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.line, overflow: "hidden" }}><View style={{ width: `${tier.data.progress}%`, height: 8, backgroundColor: t.warning }} /></View>
          <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("باقي {n} نقطة للمستوى {t}", { n: tier.data.next.pointsNeeded, t: tier.data.next.name })}</Txt>
        </> : null}
      </Card>
      <Card style={{ marginTop: 12 }}>
        <ListRow testID="menu-account" icon={icon(MapPin)} title="بياناتي وعناويني" detail="الاسم والهاتف والعناوين" onPress={go("/account")} />
        <ListRow testID="menu-passport" icon={icon(Globe2)} title="جوازي العالمي" detail="اهتماماتي ومنطقتي — تُحفظ على الجهاز" onPress={go("/passport")} />
        <ListRow testID="menu-robot" icon={icon(Bot)} title="شخصيتي وحركتها" detail="لون وملابس وحركات لُقطي" onPress={go("/robot")} />
        <ListRow testID="menu-appearance" icon={icon(Globe)} title="اللغة والمظهر" detail="التصميم، عربي/English، نهاري/ليلي، العملة" onPress={go("/appearance")} />
        <ListRow testID="menu-notifications" icon={icon(Bell)} title="الإشعارات" detail={store.unreadCount ? tr("{n} غير مقروءة", { n: store.unreadCount }) : undefined} onPress={go("/notifications")} />
        <ListRow testID="menu-privacy" icon={icon(ShieldCheck)} title="الخصوصية والأجهزة" detail="الأجهزة وكلمة المرور وسجل البحث" onPress={go("/privacy")} />
        <ListRow testID="menu-export" icon={icon(Download)} title="تصدير بياناتي" onPress={() => router.push({ pathname: "/privacy", params: { section: "export" } })} />
      </Card>
      <Card style={{ marginTop: 12 }}>
        <ListRow icon={icon(Package)} title="طلباتي" onPress={go("/orders")} />
        <ListRow icon={icon(Wallet)} title="المحفظة وبطاقات الهدايا" onPress={go("/wallet")} />
        <ListRow icon={icon(Wand2)} title="الأدوات الذكية" onPress={go("/smart-tools")} />
        <ListRow testID="menu-nearby" icon={icon(MapPin)} title="المتاجر القريبة" detail="الفروع حولك على الخريطة وما يتوفر فيها" onPress={go("/nearby")} />
        <ListRow testID="menu-companion" icon={icon(Bot)} title="رفيقك الذكي" detail="نيرا أو أوريون أو سِلك، بطلبك وكلماتك" onPress={go("/companion")} />
        <ListRow icon={icon(Gift)} title="مكافآتي والدعوات" onPress={go("/rewards")} />
        <ListRow icon={icon(PiggyBank)} title="ميزانيتي الأسبوعية" onPress={go("/budget")} />
        <ListRow icon={icon(Refrigerator)} title="مخزن البيت" detail="الصلاحية وتوفير الكربون" onPress={go("/pantry")} />
        <ListRow icon={icon(ListChecks)} title="قوائمي" onPress={go("/lists")} />
        <ListRow icon={icon(Headset)} title="الدعم" onPress={go("/support")} />
        <ListRow icon={icon(HelpCircle)} title="مركز المساعدة" onPress={go("/help")} />
      </Card>
      <Card style={{ marginTop: 12 }}>
        {user.role === "admin" ? <ListRow icon={icon(LayoutDashboard)} title="لوحة القيادة" detail="المؤشرات والمنتجات والطلبات والمزامنة" onPress={go("/admin")} /> : null}
        {user.role === "admin" ? <ListRow icon={icon(ChartPie)} title="إدارة المشروع" onPress={go("/admin/project")} /> : null}
        {vendors.data?.vendors.length ? <ListRow icon={icon(Store)} title="لوحة التاجر" detail={vendors.data.vendors.map((v) => v.name).join("، ")} onPress={go("/vendor")} /> : null}
        {user.role === "driver" ? <ListRow icon={icon(Truck)} title="لوحة السائق" onPress={go("/driver")} /> : null}
        <ListRow icon={icon(Share2)} title="ربط Facebook" onPress={go("/social")} />
        <ListRow icon={icon(Server)} title={configured ? "اتصال الخادم" : "إعداد اتصال الخادم"} onPress={go("/connection")} />
      </Card>
      <Card style={{ marginTop: 12 }}>
        <ListRow testID="logout" icon={<LogOut size={19} color={t.danger} />} title="تسجيل الخروج" danger onPress={() => void logout()} />
        <ListRow icon={<Trash size={19} color={t.danger} />} title="حذف الحساب" danger onPress={go("/delete-account")} />
      </Card>
      <View style={{ alignItems: "center", marginTop: 18 }}>
        <Mascot size={100} motion="sleep" bubble="top" message="Zzz… اضغطني لأصحو" />
      </View>
    </Shell>
  );
}
