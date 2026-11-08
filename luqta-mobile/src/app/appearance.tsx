import React from "react";
import { Pressable, View } from "react-native";
import { Check, Monitor, Moon, Sun, Languages, Coins, Palette, Sparkles } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Card, Chip, Notice, Row, Txt } from "../components/ui";
import { ThemeMode, useTheme, type Design } from "../lib/theme";
import { useI18n, type Lang } from "../lib/i18n";
import { useMoney } from "../lib/money";
import { useSession } from "../lib/session";
import { api } from "../lib/api";

const THEMES = [
  { mode: "light", title: "الوضع النهاري", detail: "ألوان فاتحة طوال الوقت", icon: Sun },
  { mode: "dark", title: "الوضع الليلي", detail: "ألوان داكنة طوال الوقت", icon: Moon },
  { mode: "system", title: "حسب إعداد الجهاز", detail: "يتغير تلقائيًا مع مظهر جهازك", icon: Monitor },
] as const;
// Two designs live side by side; the shopper picks one, and the classic design stays the default.
const DESIGNS = [
  { design: "classic", title: "التصميم الكلاسيكي", detail: "ألوان لُقطة البنفسجية والمرجانية، كما عرفتها", icon: Palette },
  { design: "rafiq", title: "تصميم رفيق", detail: "سوق عائم ورفيق ذكي وخريطة للفروع القريبة، بألوان خضراء وذهبية", icon: Sparkles },
] as const;
const LANGS: [Lang, string, string][] = [["ar", "العربية", "من اليمين إلى اليسار"], ["en", "English", "Left to right"]];

export default function AppearanceScreen() {
  const { colors: t, mode, setMode, isDark, storageError, hydrated, design, setDesign, designRecovered } = useTheme();
  const { t: tr, lang, setLang, displayCurrency, setDisplayCurrency } = useI18n();
  const money = useMoney();
  const { user } = useSession();
  const pickLang = (next: Lang) => { setLang(next); if (user) void api.patch("/me/preferences", { locale: next }).catch(() => {}); };
  const pickCurrency = (code: string | null) => { setDisplayCurrency(code); if (user) void api.patch("/me/preferences", { displayCurrency: code }).catch(() => {}); };
  const rates = Object.entries(money.rates);
  const option = (selected: boolean, key: string, title: string, detail: string, icon: React.ReactNode, onPress: () => void, testID?: string) => (
    <Pressable key={key} testID={testID} accessibilityRole="radio" accessibilityLabel={tr(title)} aria-checked={selected} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row-reverse", alignItems: "center", gap: 14, padding: 16, borderRadius: 20, borderWidth: selected ? 2 : 1, borderColor: selected ? t.primary : t.line, backgroundColor: selected ? t.primarySoft : t.paper, opacity: pressed ? 0.85 : 1 })}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}><Txt weight="bold">{tr(title)}</Txt><Txt style={{ color: t.muted, fontSize: 12 }}>{tr(detail)}</Txt></View>
      {selected ? <Check color={t.primary} size={20} /> : null}
    </Pressable>
  );
  return (
    <Shell title="اللغة والمظهر" subtitle="يُحفظ اختيارك على هذا الجهاز وفي حسابك" robot testID="appearance">
      {designRecovered ? <View style={{ marginBottom: 12 }}><Notice text="أُغلق التطبيق أثناء تشغيل تصميم رفيق، فعاد إلى التصميم الكلاسيكي تلقائيًا. يمكنك تجربة تصميم رفيق مرة أخرى." tone="warning" /></View> : null}
      <Txt weight="bold" style={{ marginBottom: 8 }}>{tr("التصميم")}</Txt>
      <View style={{ gap: 10, marginBottom: 20 }} accessibilityRole="radiogroup">
        {DESIGNS.map((d) => option(design === d.design, d.design, d.title, d.detail, <d.icon color={design === d.design ? t.primary : t.muted} size={22} />, () => hydrated && setDesign(d.design as Design), `design-${d.design}`))}
      </View>
      <Txt weight="bold" style={{ marginBottom: 8 }}>{tr("المظهر")}</Txt>
      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        {THEMES.map((c) => option(mode === c.mode, c.mode, c.title, c.detail, <c.icon color={mode === c.mode ? t.primary : t.muted} size={22} />, () => hydrated && setMode(c.mode as ThemeMode), `theme-${c.mode}`))}
      </View>
      <Txt style={{ color: t.muted, fontSize: 12, marginTop: 6 }} testID="theme-state">{tr(isDark ? "المظهر الحالي: ليلي" : "المظهر الحالي: نهاري")}</Txt>
      {storageError ? <Notice text="طُبّق المظهر الآن، لكن تعذّر حفظ التفضيل على هذا الجهاز." tone="warning" /> : null}
      <Row style={{ marginTop: 20, marginBottom: 8 }}><Languages size={18} color={t.primary} /><Txt weight="bold">{tr("اللغة")}</Txt></Row>
      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        {LANGS.map(([code, title, detail]) => option(lang === code, code, title, detail, <Txt weight="extra" style={{ fontSize: 18, color: t.primary }}>{code.toUpperCase()}</Txt>, () => pickLang(code), `lang-${code}`))}
      </View>
      <Row style={{ marginTop: 20, marginBottom: 8 }}><Coins size={18} color={t.primary} /><Txt weight="bold">{tr("عملة العرض")}</Txt></Row>
      <Card style={{ gap: 10 }} testID="currency">
        <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("الأسعار تُدفع بعملة المتجر ({c})، ويظهر بجانبها سعر تقريبي بالعملة التي تختارها.", { c: money.currency })}</Txt>
        <Row wrap>
          <Chip label={tr("{c} فقط", { c: money.currency })} active={!displayCurrency} onPress={() => pickCurrency(null)} testID="currency-none" />
          {rates.map(([code, rate]) => <Chip key={code} testID={`currency-${code}`} label={`${code} · ${rate}`} active={displayCurrency === code} onPress={() => pickCurrency(code)} />)}
        </Row>
        {!rates.length ? <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("تظهر العملات المتاحة عند الاتصال بخادم المتجر.")}</Txt> : null}
        <Txt testID="currency-example">{tr("مثال: {p}", { p: money.format(10) })} {money.approx(10) || ""}</Txt>
      </Card>
    </Shell>
  );
}
