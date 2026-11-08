// First-run interactive tour (from the Aura app) — explains the main areas with the
// companion; can be replayed from أدوات لُقطة الذكية › جولة تعريفية.
import React, { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Txt } from "../ui";
import { CTA } from "../design/kit";
import { Mascot } from "../Robot";
import { useTheme } from "../../lib/theme";
import type { RobotMotion } from "../../lib/robot";

const KEY = "luqta-tour-v1";
const STEPS: { title: string; text: string; action: RobotMotion; href?: Href }[] = [
  { title: "أهلًا بك في لُقطة 👋", text: "أنا رفيقك في التسوق. سأعرّفك على أهم الأدوات في أقل من دقيقة.", action: "wave" },
  { title: "اسأل أو ابحث", text: "اكتب ما تريد في مربع البحث أو اضغط الميكروفون للبحث الصوتي، والكاميرا للبحث بالصورة.", action: "come" },
  { title: "أدوات لُقطة الذكية", text: "نبض السوق، رادار الأسعار، تنبيهات الأسعار، العدسة الذكية وقارئ الفواتير — كلها في «الأدوات».", action: "idle", href: "/smart-tools" },
  { title: "سلة أذكى", text: "محسّن السلة يقترح بدائل أوفر وحزم توفير ويخبرك كم تحتاج للتوصيل المجاني.", action: "walk" },
  { title: "العائلة والمكافآت", text: "أنشئ قائمة عائلية برمز دعوة، سجّل يوميًا، والعب «العب واربح» لتجمع النقاط والشارات.", action: "dance" },
  { title: "شخصيتك ثلاثية الأبعاد", text: "خصّص شكلي من «شخصيتي» — ولن أضغط أي زر أو أشتري شيئًا بدلًا منك أبدًا.", action: "jump" },
];

export function useTourState(force: boolean) {
  const [unseen, setUnseen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(KEY).then((v) => { if (active && !v) setUnseen(true); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const close = () => { setDismissed(true); setUnseen(false); void AsyncStorage.setItem(KEY, new Date().toISOString()).catch(() => {}); };
  return { open: !dismissed && (force || unseen), close };
}

export function TourOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colors: t } = useTheme();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(19,0,80,0.55)", justifyContent: "flex-end", padding: 16 }} testID="tour">
        <View style={{ backgroundColor: t.card, borderRadius: 28, padding: 18, gap: 10 }}>
          <View style={{ flexDirection: "row-reverse", alignItems: "flex-end", gap: 8 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Txt weight="extra" style={{ fontSize: 21, color: t.title }}>{step.title}</Txt>
              <Txt style={{ color: t.ink, lineHeight: 26 }}>{step.text}</Txt>
            </View>
            <Mascot key={i} size={110} motion={step.action} bubble="none" mode="still" />
          </View>
          <View style={{ flexDirection: "row-reverse", justifyContent: "center", gap: 6 }}>{STEPS.map((_, k) => <View key={k} style={{ width: k === i ? 20 : 8, height: 8, borderRadius: 4, backgroundColor: k === i ? t.orange : t.line }} />)}</View>
          <View style={{ flexDirection: "row-reverse", gap: 8, alignItems: "center" }}>
            <View style={{ flex: 1 }}><CTA title={last ? "ابدأ التسوق" : "التالي"} onPress={() => { if (last) { setI(0); onClose(); } else setI(i + 1); }} testID="tour-next" /></View>
            {step.href ? <Pressable accessibilityRole="button" onPress={() => { onClose(); router.push(step.href as Href); }} style={{ padding: 10 }}><Txt weight="bold" style={{ color: t.purple }}>افتح الآن</Txt></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="تخطي الجولة" onPress={() => { setI(0); onClose(); }} style={{ padding: 10 }} testID="tour-skip"><Txt style={{ color: t.muted }}>تخطي</Txt></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
