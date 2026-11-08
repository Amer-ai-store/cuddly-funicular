// The "new version available" card on the home screen (Android builds only).
import React from "react";
import { Pressable, View } from "react-native";
import * as Linking from "expo-linking";
import { Download, X } from "lucide-react-native";
import { Txt } from "./ui";
import { useAppUpdate } from "../lib/useAppUpdate";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/theme";

export function UpdateBanner() {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { update, current, dismiss } = useAppUpdate();
  if (!update) return null;
  return (
    <View testID="update-banner" accessibilityLiveRegion="polite" style={{ flexDirection: "row-reverse", alignItems: "center", gap: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: t.orange, backgroundColor: t.orangeSoft, marginBottom: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: t.orange, alignItems: "center", justifyContent: "center" }}><Download size={20} color={t.onAccent} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="bold" style={{ fontSize: 14 }}>{tr("نسخة جديدة متاحة: {v}", { v: update.version })}</Txt>
        <Txt style={{ fontSize: 12, color: t.muted }}>{tr("نسختك {c}. ثبّت الجديدة فوقها وتبقى بياناتك.", { c: current || "" })}</Txt>
      </View>
      <Pressable testID="update-download" accessibilityRole="link" accessibilityLabel={tr("تحميل النسخة الجديدة")} onPress={() => void Linking.openURL(update.url).catch(() => {})} style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 12, backgroundColor: t.orange, justifyContent: "center" }}>
        <Txt weight="bold" style={{ color: t.onAccent, fontSize: 13 }}>{tr("تحميل")}</Txt>
      </Pressable>
      <Pressable testID="update-later" accessibilityRole="button" accessibilityLabel={tr("لاحقًا")} onPress={dismiss} hitSlop={10}><X size={18} color={t.muted} /></Pressable>
    </View>
  );
}
