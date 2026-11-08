// Phone OTP + Google sign-in UI (shared by تسجيل الدخول and إنشاء حساب).
import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as ExpoLinking from "expo-linking";
import Svg, { Path } from "react-native-svg";
import { Smartphone } from "lucide-react-native";
import { Txt } from "./ui";
import { Card, Chip, CTA, Field, InfoNote } from "./design/kit";
import { api } from "../lib/api";
import { useSession, type SessionUser } from "../lib/session";
import { useTheme } from "../lib/theme";

type Providers = { phone: { enabled: boolean; provider: string | null; demo: boolean }; google: { enabled: boolean } };
type AuthResult = { token: string; user: SessionUser; isNew?: boolean; recoveryCode?: string };

export function useAuthProviders() {
  const { configured, baseUrl } = useSession();
  const [p, setP] = useState<{ base: string; value: Providers } | null>(null);
  useEffect(() => { let a = true; if (!configured) return; api.get<Providers>("/auth/providers").then((r) => { if (a) setP({ base: baseUrl, value: r }); }).catch(() => {}); return () => { a = false; }; }, [configured, baseUrl]);
  return configured && p?.base === baseUrl ? p.value : null;
}

export function RecoveryNotice({ code, onDone }: { code: string; onDone: () => void }) {
  const { colors: t } = useTheme();
  return (
    <Card style={{ gap: 10, backgroundColor: t.orangeSoft }} testID="recovery-notice">
      <Txt weight="extra" style={{ fontSize: 19, color: t.title }}>احفظ رمز استرداد حسابك</Txt>
      <Txt style={{ color: t.ink, lineHeight: 24 }}>تحتاجه لاسترداد الحساب أو حذفه إذا فقدت رقم هاتفك أو حساب Google. لن يظهر مرة أخرى.</Txt>
      <Txt selectable accessibilityLabel="رمز الاسترداد، اضغط مطولًا لنسخه" weight="bold" style={{ color: t.orange, fontSize: 18, textAlign: "center" }}>{code}</Txt>
      <CTA title="حفظته — متابعة" onPress={onDone} testID="recovery-done" />
    </Card>
  );
}

export function GoogleButton({ disabled, onError }: { disabled?: boolean; onError: (m: string) => void }) {
  const { colors: t } = useTheme();
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const returnUrl = Platform.OS === "web" && typeof window !== "undefined" ? `${window.location.origin}/auth` : ExpoLinking.createURL("auth");
      const r = await api.post<{ url: string }>("/auth/google/start", { returnUrl });
      if (Platform.OS === "web") window.location.assign(r.url); else await Linking.openURL(r.url);
    } catch (e) { onError(e instanceof Error ? e.message : "تعذّر بدء الدخول بـ Google"); } finally { setBusy(false); }
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="المتابعة باستخدام Google" testID="google-signin" disabled={disabled || busy} onPress={() => void start()}
      style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 54, borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.card, opacity: disabled ? 0.5 : 1 }}>
      <Svg width={22} height={22} viewBox="0 0 48 48"><Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><Path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></Svg>
      <Txt weight="bold" style={{ fontSize: 17, color: t.ink }}>{busy ? "جارٍ الفتح…" : "المتابعة باستخدام Google"}</Txt>
    </Pressable>
  );
}

export function PhoneSignIn({ demo, askName = false, onDone }: { demo: boolean; askName?: boolean; onDone: (r: AuthResult) => void }) {
  const { colors: t } = useTheme();
  const { adoptSession } = useSession();
  const [phone, setPhone] = useState(""); const [name, setName] = useState("");
  const [sent, setSent] = useState<{ phone: string; devCode?: string } | null>(null);
  const [code, setCode] = useState(""); const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(id); }, [left]);
  async function send() {
    setError(""); setBusy(true);
    try { const r = await api.post<{ phone: string; devCode?: string; expiresIn: number }>("/auth/phone/start", { phone }); setSent(r); setLeft(60); setCode(""); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر إرسال الرمز"); } finally { setBusy(false); }
  }
  async function verify() {
    if (!sent) return; setError(""); setBusy(true);
    try { const r = await api.post<AuthResult>("/auth/phone/verify", { phone: sent.phone, code, name: name.trim() || undefined }); await adoptSession(r); onDone(r); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر التحقق"); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10 }} testID="phone-signin">
      {!sent ? (
        <>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}>
            <Smartphone size={22} color={t.purple} />
            <TextInput testID="phone-input" accessibilityLabel="رقم الهاتف" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="07XXXXXXXX" placeholderTextColor={t.mutedSoft}
              style={{ flex: 1, minWidth: 0, minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.field, paddingHorizontal: 14, fontSize: 18, color: t.ink, textAlign: "left", writingDirection: "ltr", fontFamily: "Tajawal_500Medium" }} />
          </View>
          {askName ? <Field label="الاسم" placeholder="اسمك (للحسابات الجديدة)" value={name} onChangeText={setName} testID="phone-name" /> : null}
          <CTA title="أرسل رمز التحقق" busy={busy} disabled={phone.replace(/\D/g, "").length < 9} onPress={() => void send()} testID="phone-send" />
        </>
      ) : (
        <>
          <Txt style={{ color: t.ink }}>أرسلنا رمزًا من 6 أرقام إلى <Txt weight="bold" style={{ writingDirection: "ltr" }}>{sent.phone}</Txt></Txt>
          {sent.devCode ? <Chip label={`وضع التطوير — الرمز: ${sent.devCode}`} tone="demo" /> : null}
          <TextInput testID="otp-input" accessibilityLabel="رمز التحقق" value={code} onChangeText={(v) => setCode(v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode" placeholder="••••••" placeholderTextColor={t.mutedSoft}
            style={{ minHeight: 60, borderRadius: 16, borderWidth: 1, borderColor: t.line, backgroundColor: t.field, fontSize: 28, letterSpacing: 10, color: t.title, textAlign: "center", fontFamily: "Tajawal_700Bold" }} />
          <CTA title="تحقق وادخل" busy={busy} disabled={code.length !== 6} onPress={() => void verify()} testID="otp-verify" />
          <View style={{ flexDirection: "row-reverse", justifyContent: "space-between" }}>
            <Pressable accessibilityRole="button" disabled={left > 0 || busy} onPress={() => void send()}><Txt style={{ color: left > 0 ? t.mutedSoft : t.orange }}>{left > 0 ? `إعادة الإرسال بعد ${left} ث` : "إعادة إرسال الرمز"}</Txt></Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setSent(null); setCode(""); }}><Txt style={{ color: t.purple }}>تغيير الرقم</Txt></Pressable>
          </View>
        </>
      )}
      {error ? <Txt accessibilityRole="alert" style={{ color: t.danger }}>{error}</Txt> : null}
      {demo ? <InfoNote text="الخادم في وضع تطوير الرسائل: يظهر الرمز هنا بدل إرسال SMS. اربط Bird أو Twilio للإنتاج." tone="warn" /> : null}
    </View>
  );
}

export function goAfterLogin() { router.replace("/profile"); }
