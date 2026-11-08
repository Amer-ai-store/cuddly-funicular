// WP-02 admin two-step verification (TOTP): gate shown before the dashboard when the
// server requires a fresh code for this session, and a card to enable / disable it.
import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Txt } from "../ui";
import { AdminCard, AdminField, AdminNotice, useAdminAction } from "./AdminUI";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme";

type Status = { available: boolean; enabled: boolean; verified: boolean; required: boolean };
function useMfaStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const reload = useCallback(async () => { try { setStatus(await api.get<Status>("/auth/mfa/status")); } catch { setStatus({ available: false, enabled: false, verified: false, required: false }); } }, []);
  useEffect(() => { const id = setTimeout(() => void reload(), 0); return () => clearTimeout(id); }, [reload]);
  return { status, reload };
}

export function MfaGate({ children, wrap = (n) => <>{n}</> }: { children: React.ReactNode; wrap?: (node: React.ReactNode) => React.ReactElement }) {
  const { colors: c } = useTheme();
  const { status, reload } = useMfaStatus();
  const action = useAdminAction();
  const [code, setCode] = useState("");
  if (!status) return wrap(<Txt style={{ color: c.muted }}>جارٍ التحقق من الجلسة…</Txt>);
  if (!status.required) return <>{children}</>;
  return wrap(
    <AdminCard title="التحقق بخطوتين">
      <AdminNotice error={action.error} message={action.message} />
      <Txt style={{ color: c.muted, lineHeight: 22 }}>أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة على هاتفك لإكمال الدخول إلى لوحة الإدارة.</Txt>
      <AdminField label="رمز التحقق" value={code} onChangeText={setCode} numeric placeholder="123456" />
      <Button title="تحقق" busy={action.busy} onPress={() => void action.run(() => api.post("/auth/mfa/verify", { code: code.trim() }), "تم التحقق", reload)} />
    </AdminCard>
  );
}

export function MfaSettingsCard() {
  const { colors: c } = useTheme();
  const { status, reload } = useMfaStatus();
  const action = useAdminAction();
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  if (!status?.available) return null;
  return (
    <AdminCard title="أمان حساب الإدارة: التحقق بخطوتين">
      <AdminNotice error={action.error} message={action.message} />
      {status.enabled ? <>
        <Txt style={{ color: c.green }}>مفعّل — كل جلسة إدارة جديدة تحتاج رمزًا من تطبيق المصادقة.</Txt>
        <AdminField label="رمز حالي لإيقافه" value={code} onChangeText={setCode} numeric />
        <Button title="إيقاف التحقق بخطوتين" secondary busy={action.busy} onPress={() => void action.run(() => api.post("/auth/mfa/disable", { code: code.trim() }), "أُوقف التحقق بخطوتين", async () => { setCode(""); await reload(); })} />
      </> : setup ? <View style={{ gap: 8 }}>
        <Txt style={{ color: c.ink, lineHeight: 22 }}>أضف حسابًا جديدًا في Google Authenticator أو Microsoft Authenticator بالمفتاح التالي (اختر «إدخال مفتاح الإعداد»، النوع: حسب الوقت):</Txt>
        <Txt selectable weight="bold" style={{ color: c.title, fontSize: 18, letterSpacing: 1, textAlign: "center" }}>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</Txt>
        <AdminField label="الرمز الظاهر في التطبيق" value={code} onChangeText={setCode} numeric />
        <Button title="تأكيد وتفعيل" busy={action.busy} onPress={() => void action.run(() => api.post("/auth/mfa/enable", { code: code.trim() }), "فُعّل التحقق بخطوتين", async () => { setSetup(null); setCode(""); await reload(); })} />
      </View> : <>
        <Txt style={{ color: c.muted, lineHeight: 22 }}>يحمي لوحة الإدارة حتى لو عُرفت كلمة المرور أو سُرق الهاتف المسجّل برقمك.</Txt>
        <Button title="بدء الإعداد" secondary busy={action.busy} onPress={() => void action.run(async () => setSetup(await api.post<{ secret: string; otpauth: string }>("/auth/mfa/setup", {})), "انسخ المفتاح إلى تطبيق المصادقة")} />
      </>}
    </AdminCard>
  );
}
