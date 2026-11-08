import React, { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import * as Linking from "expo-linking";
import { Shell } from "../components/Shell";
import { Button, Txt } from "../components/ui";
import { AccountCard, AccountGate, errorMessage, FormMessage } from "../components/AccountKit";
import { api } from "../lib/api";
import { useAccountResource } from "../lib/accountResource";
import { useTheme } from "../lib/theme";

type FacebookStatus = { configured: boolean; linked: boolean; connected?: boolean; profile?: { id?: string; name?: string }; permissions?: string[] };
function SocialContent() {
  const { colors: t } = useTheme();
  const resource = useAccountResource<FacebookStatus>("/auth/facebook/status");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const connect = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await api.post<{ url: string }>("/auth/facebook/start", { redirectUri: Linking.createURL("/social") });
      const target = new URL(result.url);
      if (target.protocol !== "https:" || !["www.facebook.com", "facebook.com"].includes(target.hostname)) throw new Error("الخادم لم يُرجع عنوان موافقة Facebook صالحًا.");
      await Linking.openURL(result.url);
      setMessage("أكمل موافقة Facebook في المتصفح، ثم ارجع وحدّث حالة الربط. لا يصبح الربط ناجحًا إلا بعد إكمال الموافقة على خادم Meta.");
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setMessage("");
    try { await api.delete("/auth/facebook"); setConfirmUnlink(false); resource.reload(); setMessage("فُصل ارتباط Facebook من حساب المتجر. لإلغاء أذونات التطبيق لدى Meta أيضًا، استخدم إعدادات التطبيقات في Facebook."); }
    catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  const linked = resource.data?.linked || resource.data?.connected;
  return <View style={{ gap: 17 }}><Button title="تحديث حالة ربط Facebook" secondary disabled={busy || resource.loading} onPress={resource.reload} />{resource.loading ? <ActivityIndicator color={t.orange} /> : null}<FormMessage text={resource.error || message} />{resource.data ? <AccountCard><Txt weight="bold" style={{ fontSize: 22 }}>{linked ? "حساب Facebook مرتبط" : resource.data.configured ? "يمكن طلب الموافقة الرسمية" : "إعداد تطبيق Meta غير مكتمل"}</Txt>{linked ? <><Txt style={{ lineHeight: 26 }}>الحساب: {resource.data.profile?.name || "حساب تمت موافقته لدى Facebook"}</Txt>{resource.data.permissions?.length ? <Txt style={{ color: t.muted, lineHeight: 25 }}>الصلاحيات الممنوحة: {resource.data.permissions.join("، ")}</Txt> : null}{confirmUnlink ? <><Button title="تأكيد فصل حساب Facebook" onPress={() => void disconnect()} busy={busy} /><Button title="إلغاء الفصل" secondary onPress={() => setConfirmUnlink(false)} /></> : <Button title="فصل ارتباط Facebook" secondary onPress={() => setConfirmUnlink(true)} />}</> : <><Txt style={{ color: t.muted, lineHeight: 27 }}>{resource.data.configured ? "سيفتح Facebook شاشة الموافقة الرسمية. يمكنك مراجعة الصلاحيات أو رفضها. لا نطلب كلمة مرور Facebook داخل المتجر." : "يحتاج مالك الخادم إلى تطبيق Meta فعلي، ومعرّف التطبيق وسرّه وعنوان callback مسجّل. لا تُعتبر هذه الميزة مفعّلة أو مختبرة مع Facebook قبل اكتمال الإعداد والموافقة."}</Txt>{resource.data.configured ? <Button title="متابعة إلى موافقة Facebook" onPress={() => void connect()} busy={busy} /> : null}</>}</AccountCard> : null}<AccountCard><Txt weight="bold">أذونات الحساب والوكلاء</Txt><Txt style={{ color: t.muted, lineHeight: 27 }}>رابط الملف الشخصي لا يمنح الوكيل أي إذن. ربط الهوية الأساسية لا يسمح تلقائيًا بإدارة صفحاتك أو نشر منشوراتك أو قراءة رسائلك. صلاحيات المتجر للوكلاء تُدار بمفاتيح مستقلة من لوحة الإدارة، وأي صلاحية Meta إضافية تحتاج موافقتك واعتماد Meta المناسب.</Txt></AccountCard></View>;
}
export default function SocialScreen() { return <Shell title="ربط Facebook" subtitle="ربط رسمي عبر OAuth، مع بيان حالة الإعداد والموافقة الفعلية."><AccountGate><SocialContent /></AccountGate></Shell>; }
