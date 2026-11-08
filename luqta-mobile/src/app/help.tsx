import React, { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ChevronDown, Search, ThumbsUp } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Button, Card, Chip, Row, Txt } from "../components/ui";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";

type Faq = { id: string; category: string; question: string; answer: string };
const CATEGORY: Record<string, string> = { delivery: "التوصيل", returns: "الإرجاع", payment: "الدفع", orders: "الطلبات", rewards: "النقاط", account: "الحساب", privacy: "الخصوصية", wallet: "المحفظة", general: "عام" };

export default function HelpCenter() {
  const { colors: t } = useTheme();
  const { t: tr, isRTL } = useI18n();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [thanked, setThanked] = useState<string[]>([]);
  const faqs = useApi<{ faqs: Faq[]; categories: string[] }>(`/faqs?${new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(category ? { category } : {}) })}`);
  return (
    <Shell title="مركز المساعدة" subtitle="إجابات سريعة لأكثر الأسئلة شيوعًا" robot testID="help">
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, backgroundColor: t.paper, borderRadius: 18, borderWidth: 1, borderColor: t.line, paddingHorizontal: 12, minHeight: 52 }}>
        <Search size={18} color={t.muted} />
        <TextInput testID="faq-search" accessibilityLabel={tr("ابحث في المساعدة")} value={q} onChangeText={setQ} placeholder={tr("مثلًا: كيف أرجع منتجًا؟")} placeholderTextColor={t.muted} style={{ flex: 1, minHeight: 48, color: t.ink, fontFamily: "Tajawal_500Medium", textAlign: isRTL ? "right" : "left" }} />
      </View>
      <Row wrap style={{ marginVertical: 12 }}>
        <Chip label="الكل" active={!category} onPress={() => setCategory("")} />
        {(faqs.data?.categories || []).map((c) => <Chip key={c} testID={`faq-category-${c}`} label={CATEGORY[c] || c} active={category === c} onPress={() => setCategory(c)} />)}
      </Row>
      <View style={{ gap: 8 }}>
        {(faqs.data?.faqs || []).map((f) => (
          <Card key={f.id} testID={`faq-${f.id}`} style={{ gap: 8 }}>
            <Pressable accessibilityRole="button" aria-expanded={open === f.id} onPress={() => setOpen(open === f.id ? null : f.id)} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}>
              <Txt weight="bold" style={{ flex: 1 }}>{f.question}</Txt>
              <ChevronDown size={18} color={t.muted} style={{ transform: [{ rotate: open === f.id ? "180deg" : "0deg" }] }} />
            </Pressable>
            {open === f.id ? <>
              <Txt style={{ color: t.muted, lineHeight: 24 }}>{f.answer}</Txt>
              <Pressable accessibilityRole="button" disabled={thanked.includes(f.id)} onPress={() => { setThanked((x) => [...x, f.id]); void api.post(`/faqs/${f.id}/helpful`, {}).catch(() => {}); }} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6 }}>
                <ThumbsUp size={15} color={thanked.includes(f.id) ? t.success : t.muted} /><Txt style={{ fontSize: 12, color: thanked.includes(f.id) ? t.success : t.muted }}>{tr(thanked.includes(f.id) ? "شكرًا لتقييمك" : "أفادتني الإجابة")}</Txt>
              </Pressable>
            </> : null}
          </Card>
        ))}
        {faqs.data && !faqs.data.faqs.length ? <Txt style={{ color: t.muted }}>{tr("لا توجد نتائج مطابقة.")}</Txt> : null}
      </View>
      <Button title={tr("لم تجد إجابتك؟ تحدّث معنا")} onPress={() => router.push("/support")} style={{ marginTop: 16 }} />
    </Shell>
  );
}
