import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { Shell } from "../components/Shell";
import { Button, Txt } from "../components/ui";
import { AccountCard, AccountGate, errorMessage, FormField, FormMessage } from "../components/AccountKit";
import { useSession } from "../lib/session";
import { useStore } from "../lib/store";
import { useTheme } from "../lib/theme";

export default function DeleteAccountScreen() {
  const session = useSession();
  const { clearPersonalData } = useStore();
  const { colors: t } = useTheme();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const submit = async () => {
    if (confirmation !== "حذف حسابي") return setError("اكتب «حذف حسابي» للتأكيد.");
    if (!password) return setError("أدخل كلمة مرور حسابك.");
    setBusy(true); setError("");
    try {
      await session.deleteAccount(password);
      setPassword(""); setConfirmation("");
      try {
        await clearPersonalData();
        setDone("حُذف الحساب وبياناته الشخصية، ومُسحت بيانات الحساب من هذا الجهاز.");
      } catch {
        setDone("حُذف الحساب من الخادم، لكن تعذر مسح بيانات التطبيق المحلية. امسح بيانات التطبيق من إعدادات الهاتف.");
      }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  return <Shell title="حذف الحساب" subtitle="طلب حذف بيانات الحساب الشخصية من خادم المتجر.">
    <View style={{ width: "100%", maxWidth: 590, alignSelf: "center" }}>
      {done ? <AccountCard><FormMessage success text={done} /><Button title="العودة إلى المتجر" onPress={() => router.replace("/")} /></AccountCard> :
        <AccountGate><AccountCard>
          <Txt weight="extra" style={{ color: t.danger, fontSize: 23 }}>حذف نهائي للحساب</Txt>
          <Txt style={{ color: t.muted, lineHeight: 26 }}>سيُبطل الخادم كل جلسات حسابك ويحذف العناوين والمفضلة وبيانات الملف الشخصي. ستبقى سجلات الطلبات المالية مجهولة الهوية لأغراض المحاسبة. يلزم إنهاء الطلبات والمرتجعات النشطة وتسوية رصيد المحفظة قبل الحذف.</Txt>
          <FormField label="كلمة المرور الحالية" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
          <FormField label="اكتب: حذف حسابي" value={confirmation} onChangeText={setConfirmation} autoCorrect={false} />
          <FormMessage text={error} />
          <Button title="حذف حسابي نهائيًا" onPress={() => void submit()} busy={busy} disabled={confirmation !== "حذف حسابي" || !password} style={{ backgroundColor: t.danger }} />
          <Button title="إلغاء والعودة إلى حسابي" secondary onPress={() => router.back()} />
        </AccountCard></AccountGate>}
    </View>
  </Shell>;
}
