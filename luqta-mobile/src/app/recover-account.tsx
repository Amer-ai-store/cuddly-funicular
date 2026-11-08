import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Shell } from "../components/Shell";
import { Button, Txt } from "../components/ui";
import { AccountCard, errorMessage, FormField, FormMessage } from "../components/AccountKit";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";

export default function RecoverAccountScreen() {
  const { colors: t } = useTheme();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const submit = async () => {
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("أدخل البريد الإلكتروني لحسابك.");
    if (!code.trim()) return setError("أدخل رمز الاسترداد الذي حفظته عند إنشاء الحساب.");
    if (password.length < 10) return setError("كلمة المرور الجديدة يجب أن تتكون من 10 أحرف على الأقل.");
    if (password !== confirm) return setError("تأكيد كلمة المرور غير مطابق.");
    setBusy(true);
    try {
      await api.post("/auth/recover", { email: email.trim().toLowerCase(), recoveryCode: code.trim(), newPassword: password });
      setCode(""); setPassword(""); setConfirm(""); setDone(true);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  return <Shell title="استرداد الحساب" subtitle="إعادة تعيين كلمة المرور باستخدام الرمز الخاص الذي حفظته.">
    <View style={{ width: "100%", maxWidth: 540, alignSelf: "center" }}><AccountCard>
      {done ? <>
        <FormMessage success text="تغيّرت كلمة المرور وأُبطلت الجلسات السابقة. سجّل الدخول ثم أنشئ رمز استرداد جديدًا من صفحة حسابك." />
        <Button title="تسجيل الدخول" onPress={() => router.replace("/login")} />
      </> : <>
        {!session.configured ? <FormMessage text="اربط خادم المتجر أولًا لاسترداد الحساب." /> : null}
        <Txt style={{ color: t.muted, lineHeight: 25 }}>رمز الاسترداد مستقل عن كلمة المرور، ويُعرض مرة واحدة عند التسجيل أو عند إصداره من الملف الشخصي. لا تتوفر رسائل بريد أو SMS في هذه النسخة.</Txt>
        <FormField label="البريد الإلكتروني" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" returnKeyType="next" />
        <FormField label="رمز الاسترداد" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
        <FormField label="كلمة المرور الجديدة" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" returnKeyType="next" />
        <FormField label="تأكيد كلمة المرور الجديدة" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" returnKeyType="done" onSubmitEditing={() => { if (!busy && session.configured) void submit(); }} />
        <FormMessage text={error} />
        <Button title="إعادة تعيين كلمة المرور" onPress={() => void submit()} busy={busy} disabled={!session.configured} />
        <Button title="العودة إلى تسجيل الدخول" secondary onPress={() => router.replace("/login")} />
      </>}
    </AccountCard></View>
  </Shell>;
}
