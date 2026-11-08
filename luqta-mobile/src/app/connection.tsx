import React, { useState } from "react";
import { View } from "react-native";
import { Shell } from "../components/Shell";
import { Button, Txt } from "../components/ui";
import { AccountCard, errorMessage, FormField, FormMessage } from "../components/AccountKit";
import { api, validateServerUrl } from "../lib/api";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";

export default function ConnectionScreen() {
  const session = useSession();
  const { colors: t } = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const connect = async () => {
    setBusy(true); setMessage(""); setSuccess(false);
    try {
      const normalized = validateServerUrl(url ?? session.baseUrl);
      if (!normalized) throw new Error("أدخل عنوان الخادم أولًا.");
      const health = await api.testConnection(normalized);
      await session.configure(normalized);
      await api.get("/health");
      setUrl(null); setSuccess(true);
      setMessage(`تم التحقق من خادم لُقطة وحفظ الاتصال${health.currency ? ` · العملة ${health.currency}` : ""}. سجّل الدخول للوصول إلى بيانات حسابك.`);
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setSuccess(false); setMessage("");
    try { await session.configure(""); setUrl(null); setMessage("أُلغي الربط وحُذفت جلسة الحساب من الجهاز. الكتالوج المحلي متاح للاستعراض فقط."); setSuccess(true); }
    catch (failure) { setMessage(errorMessage(failure)); }
    finally { setBusy(false); }
  };
  return <Shell title="اتصال الخادم" subtitle="إعداد عنوان قاعدة بيانات المتجر ولوحة الإدارة المرتبطة."><View style={{ maxWidth: 700, width: "100%", gap: 18, alignSelf: "center" }}><AccountCard><Txt weight="bold" style={{ fontSize: 20 }}>{session.configured ? session.connected ? "الخادم متصل" : "عنوان محفوظ · الاتصال غير مؤكد" : "لم يُربط خادم بعد"}</Txt><FormField label="عنوان خادم المتجر" placeholder="https://store.example.com" value={url ?? session.baseUrl} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2048} style={{ textAlign: "left", writingDirection: "ltr" }} /><Txt style={{ color: t.muted, lineHeight: 26 }}>أدخل عنوان خادم لُقطة دون ‎/api. نتحقق من واجهة الصحة فعلًا قبل حفظ الاتصال. تغيير الخادم يخرجك من الحساب السابق.</Txt><FormMessage text={message} success={success} /><Button title="اختبار الاتصال وحفظه" onPress={() => void connect()} busy={busy} disabled={!session.hydrated} />{session.configured ? <Button title="إلغاء الربط والخروج من الحساب" secondary onPress={() => void disconnect()} disabled={busy} /> : null}</AccountCard><AccountCard><Txt weight="bold">التشغيل على الهاتف</Txt><Txt style={{ color: t.muted, lineHeight: 27 }}>الخادم العام يحتاج HTTPS. على الشبكة المحلية، استخدم عنوان IP لجهاز الخادم مثل ‎http://192.168.1.20:8787. عنوان localhost على الهاتف يشير إلى الهاتف نفسه، وليس الحاسوب.</Txt><Txt style={{ color: t.muted, lineHeight: 27 }}>تُنشأ قاعدة البيانات وحساب الإدارة على الخادم. ربط نظام مخزون خارجي ومفاتيح الوكلاء يُضبطان من لوحة الإدارة بعد الدخول بحساب مخوّل.</Txt></AccountCard></View></Shell>;
}
