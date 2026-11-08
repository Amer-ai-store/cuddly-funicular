// "اختر رفيقك": the three companions as cards with their faces and traits.
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Txt } from "../ui";
import { CompanionFace } from "./marks";
import { COMPANIONS, type CompanionId } from "../../lib/rafiq";
import { useI18n } from "../../lib/i18n";
import { useTheme } from "../../lib/theme";

export function CompanionPicker({ value, onChange }: { value: CompanionId; onChange: (id: CompanionId) => void }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={tr("اختر رفيقك")}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row-reverse", alignItems: "center", gap: 8, paddingVertical: 2 }}>
        <Txt style={{ fontSize: 11, color: t.muted }}>{tr("اختر رفيقك")}</Txt>
        {COMPANIONS.map((c) => {
          const on = c.id === value;
          return (
            <Pressable key={c.id} testID={`companion-${c.id}`} accessibilityRole="radio" aria-checked={on} accessibilityLabel={`${tr(c.name)}، ${tr(c.trait)}`} onPress={() => onChange(c.id)}
              style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, height: 52, paddingStart: 6, paddingEnd: 14, borderRadius: 14, borderWidth: 1, borderColor: on ? t.orange : t.line, backgroundColor: on ? t.secondary : t.paper }}>
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: "#0D1220", alignItems: "center", justifyContent: "center" }}><CompanionFace id={c.id} size={36} /></View>
              <View>
                <Txt weight="medium" style={{ fontSize: 13 }}>{tr(c.name)}</Txt>
                <Txt style={{ fontSize: 11, color: t.muted }}>{tr(c.trait)}</Txt>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
