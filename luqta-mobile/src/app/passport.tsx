import React, { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Globe2, Heart, ShieldCheck, Sparkles, UserRound } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Button, Card, Chip, Row, Txt } from "../components/ui";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { categoryName, useCategories } from "../lib/catalog";
import { EMPTY_PASSPORT, type LocalPassport, readLocalPassport, saveLocalPassport } from "../lib/localPassport";

const REGION_CHOICES = [
  { id: "JO", label: "الأردن · Jordan" },
  { id: "AE", label: "الإمارات · UAE" },
  { id: "SA", label: "السعودية · Saudi Arabia" },
  { id: "EG", label: "مصر · Egypt" },
  { id: "US", label: "USA" },
  { id: "GB", label: "United Kingdom" },
  { id: "IN", label: "India" },
  { id: "BR", label: "Brasil" },
  { id: "OTHER", label: "Other / منطقة أخرى" },
] as const;

export default function PassportScreen() {
  const { colors: t } = useTheme();
  const { t: tr, lang } = useI18n();
  const categories = useCategories();
  const [passport, setPassport] = useState<LocalPassport>(EMPTY_PASSPORT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    readLocalPassport().then((value) => { if (active) setPassport(value); })
      .catch(() => { if (active) setNotice("تعذر قراءة تفضيلات هذا الجهاز."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const change = (value: LocalPassport) => { setPassport(value); setSaved(false); setNotice(""); };
  const toggleCategory = (id: string) => {
    if (passport.categories.includes(id)) change({ ...passport, categories: passport.categories.filter((x) => x !== id) });
    else if (passport.categories.length < 8) change({ ...passport, categories: [...passport.categories, id] });
    else setNotice("يمكنك اختيار ثمانية اهتمامات كحد أقصى.");
  };
  const save = async () => {
    setBusy(true); setNotice(""); setSaved(false);
    try {
      const validCategories = new Set(categories.map((item) => item.id));
      const valid = { ...passport, categories: passport.categories.filter((id) => validCategories.has(id)) };
      const result = await saveLocalPassport(valid);
      setPassport(result);
      setSaved(true);
      setNotice("حُفظت اختياراتك على جهازك. سيظهر ترتيبك المفضل في الصفحة الرئيسية.");
    } catch { setNotice("تعذر الحفظ على هذا الجهاز؛ لا تزال الاختيارات غير محفوظة."); }
    finally { setBusy(false); }
  };

  return <Shell title="جواز لُقطة العالمي" back testID="local-passport">
    <LinearGradient colors={["#120A32", "#4533A7", "#9055CA"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ padding: 24, borderRadius: 28, gap: 13, overflow: "hidden", minHeight: 220 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Row gap={8}><Globe2 size={22} color="#C5F5F0" /><Txt weight="bold" style={{ color: "#C5F5F0", letterSpacing: 2 }}>LUQTA UNIVERSE</Txt></Row>
        <Sparkles size={24} color="#F9DC8B" />
      </Row>
      <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: "#FFFFFF22", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#FFFFFF55" }}>
        <UserRound size={32} color="#FFFFFF" />
      </View>
      <Txt weight="extra" style={{ color: "#FFFFFF", fontSize: 25 }}>{passport.displayName ? tr("عالم {name}", { name: passport.displayName }) : tr("عالمك يبدأ من هنا")}</Txt>
      <Txt style={{ color: "#E4DFFF", lineHeight: 23 }}>{tr("خصّص طريقة اكتشاف المنتجات من أي بلد، حتى دون تشغيل خادم المتجر.")}</Txt>
    </LinearGradient>

    <Card style={{ marginTop: 16, gap: 12 }}>
      <Row><UserRound size={19} color={t.primary} /><Txt weight="extra" style={{ fontSize: 18 }}>{tr("اسمي في جواز التسوق")}</Txt></Row>
      <TextInput value={passport.displayName} testID="passport-name" accessibilityLabel={tr("اسمي في جواز التسوق")} onChangeText={(displayName) => change({ ...passport, displayName })}
        maxLength={40} placeholder={tr("اسم العرض (اختياري)")} placeholderTextColor={t.muted}
        style={{ backgroundColor: t.field, color: t.ink, borderRadius: 15, borderColor: t.line, borderWidth: 1, padding: 14, fontSize: 16, textAlign: lang === "ar" ? "right" : "left" }} />
      <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("اسم محلي اختياري، وليس إثبات هوية أو حساب Google.")}</Txt>
    </Card>

    <Card style={{ marginTop: 14, gap: 11 }}>
      <Row><Globe2 size={19} color={t.primary} /><Txt weight="extra" style={{ fontSize: 18 }}>{tr("المنطقة المفضلة")}</Txt></Row>
      <Row wrap gap={8}>
        {REGION_CHOICES.map(({ id, label }) => (
          <Pressable key={id} testID={`passport-region-${id}`} accessibilityRole="radio" accessibilityState={{ selected: passport.region === id }}
            onPress={() => change({ ...passport, region: id })}
            style={{ borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: passport.region === id ? t.primary : t.line, backgroundColor: passport.region === id ? t.primarySoft : t.paper, flexDirection: "row", alignItems: "center", gap: 6 }}>
            {passport.region === id ? <Check size={15} color={t.primary} /> : null}
            <Txt style={{ fontSize: 13, color: t.ink }}>{label}</Txt>
          </Pressable>
        ))}
      </Row>
      <Txt style={{ color: t.muted, fontSize: 12 }}>{tr("اختيار المنطقة لا يعني توفر الشحن أو الدفع فيها. التوفر يُتحقق منه من الخادم.")}</Txt>
    </Card>

    <Card style={{ marginTop: 14, gap: 11 }}>
      <Row><Heart size={19} color={t.orange} /><Txt weight="extra" style={{ fontSize: 18 }}>{tr("اهتماماتي")}</Txt></Row>
      <Txt style={{ color: t.muted, fontSize: 13 }}>{tr("اختر حتى 8 أقسام. ستتقدم أصنافها في توصيات العرض المحلية.")}</Txt>
      <Row wrap gap={8}>
        {categories.map((category) => <Chip key={category.id} label={categoryName(category, lang)}
          active={passport.categories.includes(category.id)} onPress={() => toggleCategory(category.id)} testID={`passport-interest-${category.id}`} />)}
      </Row>
      <Txt style={{ color: t.muted, fontSize: 12 }}>{passport.categories.length} / 8</Txt>
    </Card>

    <Card style={{ marginTop: 14, gap: 8 }} tone="soft">
      <Row><ShieldCheck size={19} color={t.success} /><Txt weight="bold">{tr("خصوصيتك بيدك")}</Txt></Row>
      <Txt style={{ color: t.muted, fontSize: 13, lineHeight: 22 }}>{tr("هذا الجواز يحفظ اسم عرض والمنطقة والاهتمامات محليًا على الجهاز فقط. لا يمنح دور مدير، ولا يرسل بيانات إلى جوافة أو لوحة القيادة، ولا ينشئ طلبًا أو رصيدًا ماليًا.")}</Txt>
    </Card>
    {notice ? <Txt testID="passport-notice" style={{ color: saved ? t.success : t.muted, marginTop: 14 }}>{tr(notice)}</Txt> : null}
    <View style={{ gap: 10, marginTop: 16 }}>
      <Button testID="passport-save" title={loading ? tr("تحميل التفضيلات…") : tr("احفظ جوازي")} onPress={() => void save()} busy={busy} disabled={loading} />
      <Button secondary title={tr("استكشف حسب ذوقي")} onPress={() => router.replace("/")} />
      <Button secondary title={tr("اللغة والمظهر والعملات")} onPress={() => router.push("/appearance")} />
    </View>
  </Shell>;
}
