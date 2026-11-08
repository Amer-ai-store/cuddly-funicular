// "رفيقك": a full conversation with the chosen companion. It answers the shopping intents it knows with real
// products from the catalog, and hands anything else to the full assistant. The conversation stays on this screen.
import React, { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react-native";
import { Shell } from "../components/Shell";
import { Button, Txt } from "../components/ui";
import { CompanionPicker } from "../components/rafiq/CompanionPicker";
import { CompanionFace } from "../components/rafiq/marks";
import { ProductTile } from "../components/rafiq/ProductTile";
import { INTENTS, findIntent, productsForIntent } from "../lib/rafiq";
import { useCompanion } from "../lib/useCompanion";
import { useStore } from "../lib/store";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import type { Product } from "../data/products";

type Message = { id: number; from: "me" | "ai"; text: string; products?: Product[]; handoff?: string };

export default function CompanionScreen() {
  const { colors: t, fonts } = useTheme();
  const { t: tr, isRTL } = useI18n();
  const store = useStore();
  const { id, companion, choose } = useCompanion();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [seq, setSeq] = useState(1);
  const Send = isRTL ? ArrowLeft : ArrowRight;

  const send = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setText("");
    const intent = findIntent(value) || INTENTS.find((i) => i.label === value) || null;
    const picked = intent ? productsForIntent(intent, store.products) : [];
    const answer: Message = intent && picked.length
      ? { id: seq + 1, from: "ai", text: tr(intent.reply), products: picked }
      : { id: seq + 1, from: "ai", text: tr("هذا الطلب يحتاج المساعد الكامل. أنقله إليه بكلماتك نفسها."), handoff: value };
    setMessages((m) => [...m, { id: seq, from: "me", text: value }, answer]);
    setSeq((n) => n + 2);
  };
  const added = () => { setMessages((m) => [...m, { id: seq, from: "ai", text: tr(companion.added) }]); setSeq((n) => n + 1); };

  const footer = (
    <View style={{ flexDirection: "row-reverse", gap: 8, paddingBottom: 8 }}>
      <TextInput testID="companion-input" accessibilityLabel={tr("اكتب طلبك لرفيقك")} value={text} onChangeText={setText} onSubmitEditing={() => send(text)} returnKeyType="send" placeholder={tr("اطلب من رفيقك ما تحتاج…")} placeholderTextColor={t.muted}
        style={{ flex: 1, minWidth: 0, height: 50, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.paper, color: t.ink, fontFamily: fonts.medium, fontSize: 15, textAlign: isRTL ? "right" : "left" }} />
      <Pressable testID="companion-send" accessibilityRole="button" accessibilityLabel={tr("أرسل")} onPress={() => send(text)} style={{ width: 50, height: 50, borderRadius: 14, backgroundColor: t.orange, alignItems: "center", justifyContent: "center" }}>
        <Send size={20} color={t.onAccent} />
      </Pressable>
    </View>
  );

  return (
    <Shell title="رفيقك الذكي" subtitle="اختر رفيقك واطلب ما تحتاج بكلماتك" back testID="companion-screen" footer={footer}>
      <CompanionPicker value={id} onChange={(next) => { choose(next); setMessages([]); }} />
      <View style={{ marginTop: 14, gap: 12 }}>
        <Bubble from="ai" companionId={id} name={tr(companion.name)} text={tr(companion.hello)} />
        {messages.map((m) => (
          <View key={m.id} style={{ gap: 8 }}>
            <Bubble from={m.from} companionId={id} name={m.from === "ai" ? tr(companion.name) : tr("أنت")} text={m.text} />
            {m.products?.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 2 }}>
                {m.products.map((p) => <ProductTile key={p.id} product={p} prefix={`chat-${m.id}`} onAdded={added} />)}
              </ScrollView>
            ) : null}
            {m.handoff ? <Button testID={`handoff-${m.id}`} secondary title="افتح المساعد الكامل" icon={<Sparkles size={16} color={t.ink} />} onPress={() => router.navigate({ pathname: "/assistant", params: { q: m.handoff } })} style={{ alignSelf: "flex-end" }} /> : null}
          </View>
        ))}
      </View>
      <Txt weight="bold" style={{ marginTop: 20, marginBottom: 8, fontSize: 13, color: t.muted }}>{tr("جرّب أن تطلب")}</Txt>
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 }}>
        {INTENTS.map((intent) => (
          <Pressable key={intent.id} testID={`chat-intent-${intent.id}`} accessibilityRole="button" accessibilityLabel={tr(intent.label)} onPress={() => send(intent.label)}
            style={({ pressed }) => ({ width: "48%", minHeight: 58, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: pressed ? t.orange : t.line, backgroundColor: t.paper, justifyContent: "center" })}>
            <Txt weight="medium" style={{ fontSize: 13 }}>{tr(intent.label)}</Txt>
            <Txt style={{ fontSize: 11, color: t.muted }}>{tr(intent.sub)}</Txt>
          </Pressable>
        ))}
      </View>
    </Shell>
  );
}

function Bubble({ from, companionId, name, text }: { from: "me" | "ai"; companionId: Parameters<typeof CompanionFace>[0]["id"]; name: string; text: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const ai = from === "ai";
  return (
    <View testID={ai ? "bubble-ai" : "bubble-me"} style={{ flexDirection: ai ? "row-reverse" : "row", gap: 10, alignItems: "flex-end" }} accessibilityLiveRegion={ai ? "polite" : undefined}>
      {ai ? <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: "#0D1220", alignItems: "center", justifyContent: "center" }}><CompanionFace id={companionId} size={30} /></View> : null}
      <View style={{ maxWidth: "82%", gap: 3, padding: 12, borderRadius: 16, borderTopRightRadius: ai ? 4 : 16, borderTopLeftRadius: ai ? 16 : 4, backgroundColor: ai ? t.paper : t.orange, borderWidth: ai ? 1 : 0, borderColor: t.line }}>
        {ai ? <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6 }}><Txt weight="extra" style={{ fontSize: 12 }}>{name}</Txt><Txt style={{ fontSize: 10, color: t.orange }}>{tr("ذكاء اصطناعي")}</Txt></View> : null}
        <Txt style={{ fontSize: 14, lineHeight: 23, color: ai ? t.ink : t.onAccent }}>{text}</Txt>
      </View>
    </View>
  );
}
