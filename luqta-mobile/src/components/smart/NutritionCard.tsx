// Nutrition facts card for a product (from the dashboard import).
import React from "react";
import { View } from "react-native";
import { Apple } from "lucide-react-native";
import { Txt } from "../ui";
import { Card, SectionHeader } from "../design/kit";
import { useTheme } from "../../lib/theme";

export type Nutrition = { calories?: number; protein?: number; carbs?: number; fat?: number; sugar?: number; fiber?: number; sodium?: number; per?: string };
const ROWS: [keyof Nutrition, string, string][] = [["calories", "السعرات", "kcal"], ["protein", "البروتين", "غ"], ["carbs", "الكربوهيدرات", "غ"], ["fat", "الدهون", "غ"], ["sugar", "السكر", "غ"], ["fiber", "الألياف", "غ"], ["sodium", "الصوديوم", "ملغ"]];

export function NutritionCard({ nutrition, title = "القيم الغذائية" }: { nutrition?: Nutrition | null; title?: string }) {
  const { colors: t } = useTheme();
  if (!nutrition) return null;
  const rows = ROWS.filter(([k]) => nutrition[k] != null);
  if (!rows.length) return null;
  return (
    <Card style={{ marginTop: 14 }} testID="nutrition-card">
      <SectionHeader title={`${title}${nutrition.per ? ` (لكل ${nutrition.per})` : ""}`} icon={Apple} />
      <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 }}>
        {rows.map(([k, label, unit]) => (
          <View key={k} style={{ width: "31%", padding: 10, borderRadius: 14, backgroundColor: k === "calories" ? t.orangeSoft : t.field, alignItems: "center" }}>
            <Txt weight="extra" style={{ fontSize: 18, color: k === "calories" ? t.orange : t.title }}>{nutrition[k] as number}</Txt>
            <Txt style={{ fontSize: 11, color: t.muted }}>{label} ({unit})</Txt>
          </View>
        ))}
      </View>
    </Card>
  );
}
