import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Shell } from "../components/Shell";
import { Button, Txt } from "../components/ui";
import { AccountCard, errorMessage, FormField, FormMessage } from "../components/AccountKit";
import { useSession } from "../lib/session";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";

export default function RegisterScreen() {
  const session = useSession();
  const { colors: t } = useTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [referral, setReferral] = useState("");
  const [referralNote, setReferralNote] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (name.trim().length < 2) return setError("أدخل اسمًا من حرفين على الأقل.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("أدخل بريدًا إلكترونيًا صالحًا.");
    if (password.length < 10) return setError("استخدم كلمة مرور من 10 أحرف على الأقل.");
    if (password !== confirm) return setError("تأكيد كلمة المرور غير مطابق.");
    setBusy(true);
    try {
      const code = await session.register(name, email, password);
      if (referral.trim()) {
        try { await api.post("/referrals/apply", { code: referral.trim() }); setReferralNote("أُضيفت 20 نقطة ترحيب بدعوة صديقك 🎉"); }
        catch (failure) { setReferralNote(errorMessage(failure)); }
      }
      setPassword("");
      setConfirm("");
      setRecoveryCode(code);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };

  return <Shell title="إنشاء حساب" subtitle="حساب عميل مرتبط بخادم المتجر.">
    <View style={{ width: "100%", maxWidth: 540, alignSelf: "center", gap: 18 }}>
      <AccountCard>
        {recoveryCode ? <>
          <Txt weight="extra" style={{ fontSize: 23 }}>احتفظ برمز استرداد حسابك</Txt>
          <Txt style={{ color: t.muted, lineHeight: 26 }}>يُعرض هذا الرمز مرة واحدة فقط. انسخه واحفظه في مكان خاص؛ يمكنك استخدامه لإعادة تعيين كلمة المرور دون بريد أو رسالة نصية. إصدار رمز جديد من حسابك يُبطل الرمز السابق.</Txt>
          {referralNote ? <FormMessage text={referralNote} success={referralNote.includes("🎉")} /> : null}
          <Txt selectable accessibilityLabel="رمز استرداد الحساب، اضغط مطولًا لنسخه" style={{ color: t.orange, fontSize: 20, lineHeight: 30 }}>{recoveryCode}</Txt>
          <Button title="حفظت الرمز، متابعة إلى حسابي" onPress={() => { setRecoveryCode(""); router.replace("/profile"); }} />
        </> : session.user ? <>
          <Txt>أنت مسجل الدخول بالفعل.</Txt>
          <Button title="الذهاب إلى حسابي" onPress={() => router.replace("/profile")} />
        </> : <>
          {!session.configured ? <><FormMessage text="اربط خادم المتجر قبل إنشاء الحساب." /><Button title="إعداد اتصال الخادم" onPress={() => router.push("/connection")} /></> : null}
          <FormField label="الاسم الكامل" value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={100} />
          <FormField label="البريد الإلكتروني" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
          <FormField label="كلمة المرور" accessibilityHint="استخدم عشرة أحرف على الأقل" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="next" />
          <FormField label="تأكيد كلمة المرور" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" returnKeyType="done" onSubmitEditing={() => { if (!busy && session.configured) void submit(); }} />
          <FormField label="رمز دعوة صديق (اختياري)" value={referral} onChangeText={setReferral} autoCapitalize="characters" placeholder="LQXXXXXX" />
          <Txt style={{ color: t.muted, lineHeight: 24, fontSize: 13 }}>10 أحرف على الأقل. لا ترسل كلمة المرور أو رمز الاسترداد في المحادثة.</Txt>
          <FormMessage text={error} />
          <Button title="إنشاء حسابي" onPress={() => void submit()} busy={busy} disabled={!session.hydrated || !session.configured} />
          <Button title="لدي حساب بالفعل" secondary onPress={() => router.replace("/login")} />
        </>}
      </AccountCard>
    </View>
  </Shell>;
}
