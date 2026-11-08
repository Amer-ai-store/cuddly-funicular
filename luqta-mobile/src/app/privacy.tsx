import React, { useState } from "react";
import { Platform, Share, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Download, KeyRound, Laptop, Smartphone, History } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Badge, Button, Card, EmptyState, Field, Notice, Row, Toggle, Txt } from "../components/ui";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";

type Privacy = { personalizedRecommendations: boolean; shareLocationWithDriver: boolean; saveSearchHistory: boolean; analytics: boolean; marketingEmails: boolean };
type Device = { id: string; device: string; createdAt: string | null; lastSeenAt: string | null; current: boolean };
const PRIVACY: [keyof Privacy, string, string][] = [
  ["personalizedRecommendations", "توصيات مخصصة", "نستخدم طلباتك ومفضلتك لترتيب المنتجات لك"],
  ["saveSearchHistory", "حفظ سجل البحث", "لعرض عمليات بحثك الأخيرة"],
  ["shareLocationWithDriver", "مشاركة موقع التوصيل مع السائق", "يرى السائق دبوس العنوان فقط أثناء التوصيل"],
  ["analytics", "تحليلات الاستخدام", "بيانات مجهولة لتحسين التطبيق"],
  ["marketingEmails", "رسائل تسويقية", "عروض وأخبار عبر البريد"],
];

export default function PrivacyScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const params = useLocalSearchParams<{ section?: string }>();
  const { user } = useSession();
  const prefs = useApi<{ preferences: { privacy: Privacy } }>("/me/preferences", { needsUser: true });
  const sessions = useApi<{ sessions: Device[] }>("/me/sessions", { needsUser: true });
  const history = useApi<{ history: { query: string; createdAt: string }[] }>("/me/search-history", { needsUser: true });
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [recovery, setRecovery] = useState({ password: "", code: "" });
  const [message, setMessage] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const [busy, setBusy] = useState("");
  if (!user) return <Shell title="الخصوصية والأجهزة"><EmptyState title="سجّل الدخول" detail="إعدادات الخصوصية مرتبطة بحسابك." action="تسجيل الدخول" href="/login" /></Shell>;
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key); setMessage(null);
    try { const text = await fn(); if (text) setMessage({ text, tone: "success" }); } catch (e) { setMessage({ text: e instanceof Error ? e.message : "تعذر تنفيذ العملية", tone: "danger" }); } finally { setBusy(""); }
  };
  const toggle = (key: keyof Privacy, value: boolean) => run(key, async () => { const r = await api.patch<{ preferences: { privacy: Privacy } }>("/me/preferences", { privacy: { [key]: value } }); prefs.setData(r); });
  const changePassword = () => run("password", async () => {
    if (passwords.next.length < 10) throw new Error("كلمة المرور الجديدة 10 أحرف على الأقل");
    if (passwords.next !== passwords.confirm) throw new Error("تأكيد كلمة المرور غير مطابق");
    await api.post("/auth/change-password", { currentPassword: passwords.current, newPassword: passwords.next });
    setPasswords({ current: "", next: "", confirm: "" }); sessions.reload();
    return "غُيّرت كلمة المرور، وأُنهيت الجلسات على الأجهزة الأخرى";
  });
  const exportData = () => run("export", async () => {
    const r = await api.get<{ export: unknown; filename: string }>("/me/export");
    const text = JSON.stringify(r.export, null, 2);
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } else await Share.share({ title: r.filename, message: text });
    return tr("جُهّز ملف بياناتك {f}", { f: r.filename });
  });
  const date = (v: string | null) => (v ? new Date(v).toLocaleString(lang === "ar" ? "ar-JO" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const privacy = prefs.data?.preferences.privacy;
  return (
    <Shell title="الخصوصية والأجهزة" subtitle="أنت تتحكم ببياناتك" back testID="privacy">
      {message ? <Notice text={message.text} tone={message.tone} /> : null}
      <Card style={{ marginTop: 8 }} testID="privacy-toggles">
        {privacy ? PRIVACY.map(([key, label, detail]) => <Toggle key={key} testID={`privacy-${key}`} label={label} detail={detail} value={privacy[key]} onChange={(v) => void toggle(key, v)} />) : <Txt style={{ color: t.muted }}>{tr("جارٍ التحميل…")}</Txt>}
      </Card>
      <Card style={{ marginTop: 12, gap: 10 }} testID="devices">
        <Txt weight="bold">{tr("الأجهزة المسجّلة")}</Txt>
        {(sessions.data?.sessions || []).map((s) => (
          <Row key={s.id}>
            {/Android|iPhone|تطبيق/.test(s.device) ? <Smartphone size={20} color={t.primary} /> : <Laptop size={20} color={t.primary} />}
            <View style={{ flex: 1 }}><Txt weight="bold" style={{ fontSize: 14 }}>{s.device}</Txt><Txt style={{ color: t.muted, fontSize: 11 }}>{tr("آخر نشاط {d}", { d: date(s.lastSeenAt) })}</Txt></View>
            {s.current ? <Badge label="هذا الجهاز" tone="success" /> : <Button title={tr("إنهاء")} testID={`revoke-${s.id}`} secondary busy={busy === s.id} onPress={() => void run(s.id, async () => { await api.delete(`/me/sessions/${s.id}`); sessions.reload(); return "أُنهيت الجلسة"; })} style={{ minHeight: 36, paddingVertical: 4, paddingHorizontal: 12 }} />}
          </Row>
        ))}
        {(sessions.data?.sessions.length || 0) > 1 ? <Button title={tr("تسجيل الخروج من كل الأجهزة الأخرى")} testID="revoke-others" secondary onPress={() => void run("others", async () => { const r = await api.post<{ removed: number }>("/me/sessions/revoke-others", {}); sessions.reload(); return tr("أُنهيت {n} جلسات", { n: r.removed }); })} /> : null}
      </Card>
      <Card style={{ marginTop: 12, gap: 8 }} testID="change-password">
        <Row><KeyRound size={18} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("تغيير كلمة المرور")}</Txt></Row>
        <Field label="كلمة المرور الحالية" testID="current-password" secureTextEntry value={passwords.current} onChangeText={(current) => setPasswords((p) => ({ ...p, current }))} autoComplete="current-password" />
        <Field label="كلمة المرور الجديدة" testID="new-password" secureTextEntry value={passwords.next} onChangeText={(next) => setPasswords((p) => ({ ...p, next }))} autoComplete="new-password" />
        <Field label="تأكيد كلمة المرور" testID="confirm-password" secureTextEntry value={passwords.confirm} onChangeText={(confirm) => setPasswords((p) => ({ ...p, confirm }))} autoComplete="new-password" />
        <Button title={tr("تغيير كلمة المرور")} testID="submit-password" busy={busy === "password"} disabled={!passwords.current || !passwords.next} onPress={() => void changePassword()} />
      </Card>
      <Card style={{ marginTop: 12, gap: 8 }}>
        <Txt weight="bold">{tr("رمز استرداد جديد")}</Txt>
        <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("إصدار رمز جديد يُبطل الرمز السابق. احفظه في مكان آمن ولا ترسله لأحد.")}</Txt>
        <Field label="كلمة المرور" secureTextEntry value={recovery.password} onChangeText={(password) => setRecovery({ password, code: "" })} />
        {recovery.code ? <Txt selectable weight="bold" style={{ color: t.orange }}>{recovery.code}</Txt> : null}
        <Button title={tr("إصدار رمز استرداد")} secondary disabled={!recovery.password} onPress={() => void run("recovery", async () => { const r = await api.post<{ recoveryCode: string }>("/auth/recovery-code", { password: recovery.password }); setRecovery({ password: "", code: r.recoveryCode }); })} />
      </Card>
      <Card style={{ marginTop: 12, gap: 8 }} testID="search-history">
        <Row><History size={18} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("سجل البحث")}</Txt><Badge label={String(history.data?.history.length ?? 0)} /></Row>
        <Txt style={{ color: t.muted, fontSize: 12 }}>{history.data?.history.slice(0, 6).map((h) => h.query).join(" · ") || tr("لا يوجد سجل")}</Txt>
        <Button title={tr("مسح سجل البحث")} testID="clear-history" secondary disabled={!history.data?.history.length} onPress={() => void run("history", async () => { await api.delete("/me/search-history"); history.reload(); return "مُسح سجل البحث"; })} />
      </Card>
      <Card style={{ marginTop: 12, gap: 8, borderColor: params.section === "export" ? t.primary : t.line, borderWidth: params.section === "export" ? 2 : 1 }} testID="export-data">
        <Row><Download size={18} color={t.primary} /><Txt weight="bold" style={{ flex: 1 }}>{tr("تصدير بياناتي")}</Txt></Row>
        <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("ملف JSON بكل بيانات حسابك: الطلبات والعناوين والمحفظة والنقاط والقوائم والمحادثات.")}</Txt>
        <Button title={tr("تنزيل نسخة من بياناتي")} testID="export-button" tone="primary" busy={busy === "export"} onPress={() => void exportData()} />
      </Card>
    </Shell>
  );
}
