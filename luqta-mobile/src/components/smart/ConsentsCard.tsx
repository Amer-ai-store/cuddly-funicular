// NX-20 / WP-15: explicit, revocable consents stored on the store server (audited).
// Household memory powers the predicted basket and budget forecast; nothing is inferred
// without it and withdrawing it stops those features immediately.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Txt } from "../ui";
import { Card, Toggle } from "../design/kit";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";

type Consents = { personalization: boolean; household_memory: boolean; marketing: boolean };
const ROWS: { key: keyof Consents; title: string; detail: string }[] = [
  { key: "household_memory", title: "ذاكرة المنزل", detail: "نتعلم من طلباتك السابقة متى تحتاج أصنافك المتكررة لنقترح سلة أسبوعية وتقدير ميزانية شهرية. لا شراء تلقائي أبدًا." },
  { key: "personalization", title: "توصيات مخصصة", detail: "ترتيب المنتجات حسب اهتماماتك داخل المتجر فقط؛ لا تُشارك مع تجار آخرين." },
  { key: "marketing", title: "عروض وتنبيهات تسويقية", detail: "إشعارات بالعروض. يمكنك إيقافها في أي وقت." },
];

export function ConsentsCard() {
  const { colors: t } = useTheme();
  const { configured, user } = useSession();
  const [c, setC] = useState<Consents | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!configured || !user) return;
    let active = true;
    api.get<{ consents: Consents }>("/me/consents").then((r) => { if (active) setC(r.consents); }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "تعذّر تحميل الموافقات"); });
    return () => { active = false; };
  }, [configured, user]);
  const set = async (key: keyof Consents, value: boolean) => {
    const prev = c; if (c) setC({ ...c, [key]: value });
    try { const r = await api.put<{ consents: Consents }>("/me/consents", { [key]: value }); setC(r.consents); setError(""); }
    catch (e) { setC(prev); setError(e instanceof Error ? e.message : "تعذّر الحفظ"); }
  };
  return (
    <Card style={{ gap: 10, marginTop: 12 }} testID="consents">
      <Txt weight="bold" style={{ color: t.title, fontSize: 17 }}>موافقاتك</Txt>
      {!configured || !user ? <Txt style={{ color: t.muted }}>سجّل الدخول في متجر مرتبط بخادم لإدارة موافقاتك. كلها مطفأة افتراضيًا.</Txt> : ROWS.map((r) => (
        <View key={r.key} style={{ gap: 4, borderTopWidth: 1, borderColor: t.line, paddingTop: 8 }}>
          <View style={{ flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }}>
            <Txt weight="bold" style={{ color: t.ink }}>{r.title}</Txt>
            <Toggle value={!!c?.[r.key]} onChange={(v) => void set(r.key, v)} label={r.title} />
          </View>
          <Txt style={{ color: t.muted, fontSize: 13, lineHeight: 20 }}>{r.detail}</Txt>
        </View>
      ))}
      {error ? <Txt style={{ color: t.danger }}>{error}</Txt> : null}
    </Card>
  );
}
