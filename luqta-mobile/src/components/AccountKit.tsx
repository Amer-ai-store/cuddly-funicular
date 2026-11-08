import React from "react";
import { ActivityIndicator, Pressable, TextInput, TextInputProps, View } from "react-native";
import { router, type Href } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Button, Txt } from "./ui";
import { useTheme } from "../lib/theme";
import { useSession } from "../lib/session";

export function FormField({ label, ...props }: TextInputProps & { label: string }) {
  const { colors: t } = useTheme();
  return <View style={{ gap: 8 }}><Txt weight="bold" style={{ fontSize: 14 }}>{label}</Txt><TextInput {...props} accessibilityLabel={props.accessibilityLabel || label} placeholderTextColor={t.muted} style={[{ backgroundColor: t.paper, borderColor: t.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 14, color: t.ink, fontFamily: "Tajawal_400Regular", fontSize: 16, textAlign: "right", minHeight: 50 }, props.style]} /></View>;
}
export function FormMessage({ text, success = false }: { text?: string; success?: boolean }) {
  const { colors: t } = useTheme();
  if (!text) return null;
  return <View accessibilityLiveRegion="polite" style={{ borderRadius: 12, padding: 14, backgroundColor: t.paper, borderWidth: 1, borderColor: success ? t.green : t.orange }}><Txt style={{ color: success ? t.green : t.ink, lineHeight: 24 }}>{text}</Txt></View>;
}
export function AccountCard({ children }: { children: React.ReactNode }) {
  const { colors: t } = useTheme();
  return <View style={{ backgroundColor: t.paper, borderWidth: 1, borderColor: t.line, padding: 22, borderRadius: 18, gap: 17 }}>{children}</View>;
}
export function AccountGate({ children }: { children: React.ReactNode }) {
  const { colors: t } = useTheme();
  const session = useSession();
  if (!session.hydrated) return <ActivityIndicator color={t.orange} accessibilityLabel="جارٍ استعادة جلسة الحساب" />;
  if (!session.configured) return <AccountCard><Txt weight="bold" style={{ fontSize: 21 }}>اربط خادم المتجر أولًا</Txt><Txt style={{ color: t.muted, lineHeight: 26 }}>تحتاج هذه الميزة إلى اتصال فعلي بقاعدة بيانات المتجر. بيانات الكتالوج المحلية لا تُنشئ حسابًا أو رصيدًا.</Txt><Button title="إعداد اتصال الخادم" onPress={() => router.push("/connection")} /></AccountCard>;
  if (!session.user) return <AccountCard><Txt weight="bold" style={{ fontSize: 21 }}>سجّل الدخول إلى حسابك</Txt><Txt style={{ color: t.muted, lineHeight: 26 }}>الدخول مطلوب لحماية بياناتك وطلباتك.</Txt><Button title="تسجيل الدخول" onPress={() => router.push("/login")} /><Button title="إنشاء حساب" secondary onPress={() => router.push("/register")} />{session.error ? <FormMessage text={session.error} /> : null}</AccountCard>;
  return <>{children}</>;
}
export function AccountLink({ title, detail, href }: { title: string; detail?: string; href: Href }) {
  const { colors: t } = useTheme();
  return <Pressable accessibilityRole="button" onPress={() => router.push(href)} style={{ backgroundColor: t.paper, borderWidth: 1, borderColor: t.line, borderRadius: 15, padding: 18, flexDirection: "row-reverse", gap: 12, alignItems: "center" }}><View style={{ flex: 1, gap: 5 }}><Txt weight="bold" style={{ fontSize: 17 }}>{title}</Txt>{detail ? <Txt style={{ color: t.muted, lineHeight: 22, fontSize: 13 }}>{detail}</Txt> : null}</View><ArrowLeft size={18} color={t.muted} /></Pressable>;
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "تعذر تنفيذ العملية. أعد المحاولة."; }
export function accountMoney(amount: number, currency = "JOD") {
  try { return new Intl.NumberFormat("ar", { style: "currency", currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}
