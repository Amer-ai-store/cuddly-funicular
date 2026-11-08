import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Bell, BellOff, Trash } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Badge, Button, Card, EmptyState, Notice, Row, Tabs, Toggle, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";

type Item = { id: string; title: string; body: string; read: boolean; orderId: string | null; createdAt: string };
type Settings = { orders: boolean; offers: boolean; support: boolean; priceAlerts: boolean; pantry: boolean; robot: boolean };
type Alert = { id: string; productId: string; name: string; type: "price" | "stock"; targetPrice: number | null; currentPrice: number | null; triggeredAt: string | null };
const SETTINGS: [keyof Settings, string, string][] = [
  ["orders", "تحديثات الطلبات", "التأكيد والتجهيز والتوصيل ورمز التسليم"],
  ["offers", "العروض والحملات", "العروض الخاطفة والخصومات"],
  ["priceAlerts", "تنبيهات الأسعار والتوفر", "عند انخفاض السعر أو عودة منتج"],
  ["pantry", "صلاحية مخزن البيت", "قبل انتهاء صلاحية المنتجات"],
  ["support", "ردود الدعم", "عند رد فريق الدعم"],
  ["robot", "رسائل لُقطي", "نصائح ومفاجآت من الشخصية"],
];

export default function NotificationsScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const store = useStore();
  const [tab, setTab] = useState<"inbox" | "settings" | "alerts">("inbox");
  const inbox = useApi<{ notifications: Item[] }>("/notifications", { needsUser: true });
  const prefs = useApi<{ preferences: { notifications: Settings } }>("/me/preferences", { needsUser: true });
  const alerts = useApi<{ alerts: Alert[] }>("/me/alerts", { needsUser: true });
  const [error, setError] = useState("");
  if (!user) return <Shell title="الإشعارات"><EmptyState title="سجّل الدخول" detail="الإشعارات مرتبطة بحسابك." action="تسجيل الدخول" href="/login" /></Shell>;
  const act = async (fn: () => Promise<unknown>) => { setError(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "تعذر التحديث"); } };
  const readAll = () => act(async () => { await api.post("/notifications/read-all", {}); inbox.reload(); void store.refreshUnread(); });
  const open = (n: Item) => act(async () => { if (!n.read) { await api.patch(`/notifications/${n.id}`, { read: true }); void store.refreshUnread(); } if (n.orderId) router.push(`/order/${n.orderId}`); else inbox.reload(); });
  const list = inbox.data?.notifications || [];
  return (
    <Shell title="الإشعارات" testID="notifications">
      <Tabs testID="notification-tabs" value={tab} onChange={setTab} tabs={[{ id: "inbox", label: "الوارد", count: list.filter((n) => !n.read).length }, { id: "settings", label: "الإعدادات" }, { id: "alerts", label: "تنبيهاتي", count: alerts.data?.alerts.filter((a) => !a.triggeredAt).length }]} />
      {error ? <Notice text={error} tone="danger" /> : null}
      {tab === "inbox" ? (
        <View style={{ gap: 8, marginTop: 12 }}>
          {list.length ? <Button title={tr("تعليم الكل كمقروء")} testID="read-all" secondary onPress={() => void readAll()} /> : <EmptyState title="لا توجد إشعارات" detail="ستصلك هنا تحديثات طلباتك والعروض." action="" />}
          {list.map((n) => (
            <Card key={n.id} onPress={() => void open(n)} accessibilityLabel={n.title} style={{ borderColor: n.read ? t.line : t.primary }} testID={`notification-${n.id}`}>
              <Row style={{ alignItems: "flex-start" }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: n.read ? "transparent" : t.orange }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="bold">{n.title}</Txt>
                  <Txt style={{ color: t.muted, fontSize: 13, lineHeight: 20 }}>{n.body}</Txt>
                  <Txt style={{ color: t.muted, fontSize: 11 }}>{new Date(n.createdAt).toLocaleString(lang === "ar" ? "ar-JO" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Txt>
                </View>
              </Row>
            </Card>
          ))}
        </View>
      ) : null}
      {tab === "settings" ? (
        <Card style={{ marginTop: 12 }} testID="notification-settings">
          {prefs.data ? SETTINGS.map(([key, label, detail]) => <Toggle key={key} testID={`notify-${key}`} label={label} detail={detail} value={prefs.data!.preferences.notifications[key]} onChange={(value) => void act(async () => prefs.setData(await api.patch<{ preferences: { notifications: Settings } }>("/me/preferences", { notifications: { [key]: value } })))} />) : <Txt style={{ color: t.muted }}>{tr("جارٍ التحميل…")}</Txt>}
        </Card>
      ) : null}
      {tab === "alerts" ? (
        <View style={{ gap: 8, marginTop: 12 }}>
          {(alerts.data?.alerts || []).map((a) => (
            <Card key={a.id} testID={`alert-${a.id}`}>
              <Row>
                {a.triggeredAt ? <Bell size={20} color={t.success} /> : <BellOff size={20} color={t.muted} />}
                <Pressable accessibilityRole="button" style={{ flex: 1 }} onPress={() => router.push(`/product/${a.productId}`)}>
                  <Txt weight="bold">{a.name}</Txt>
                  <Txt style={{ color: t.muted, fontSize: 12 }}>{a.type === "price" ? tr("عند نزول السعر إلى {p} (الآن {c})", { p: money.format(a.targetPrice ?? 0), c: money.format(a.currentPrice ?? 0) }) : tr("عند عودة المنتج للمخزون")}</Txt>
                </Pressable>
                {a.triggeredAt ? <Badge label="تحقق" tone="success" /> : <Badge label="بانتظار" tone="muted" />}
                <Pressable accessibilityRole="button" accessibilityLabel={tr("حذف التنبيه")} onPress={() => void act(async () => { await api.delete(`/me/alerts/${a.id}`); alerts.reload(); })} style={{ padding: 6 }}><Trash size={16} color={t.danger} /></Pressable>
              </Row>
            </Card>
          ))}
          {alerts.data && !alerts.data.alerts.length ? <EmptyState title="لا توجد تنبيهات" detail="من صفحة أي منتج اضغط «تنبيه» لنخبرك عند نزول سعره أو عودته." /> : null}
        </View>
      ) : null}
    </Shell>
  );
}
