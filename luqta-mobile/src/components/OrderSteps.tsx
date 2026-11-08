import React from "react";
import { View } from "react-native";
import { Check } from "lucide-react-native";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";
import { Txt } from "./ui";

// استلام → تجهيز → بالطريق → تسليم, as in the tracking mockup.
const STEPS = [["استلام", ["pending", "confirmed"]], ["تجهيز", ["preparing"]], ["بالطريق", ["out_for_delivery"]], ["تسليم", ["delivered"]]] as const;
export function OrderSteps({ status }: { status: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  if (status === "cancelled") return <Txt weight="bold" style={{ color: t.danger }}>{tr("أُلغي هذا الطلب")}</Txt>;
  const current = STEPS.findIndex(([, statuses]) => (statuses as readonly string[]).includes(status));
  return (
    <View testID="order-steps" style={{ flexDirection: "row-reverse", alignItems: "flex-start" }}>
      {STEPS.map(([label], i) => {
        const done = i < current || status === "delivered", active = i === current && status !== "delivered";
        return (
          <View key={label} style={{ flex: 1, alignItems: "center", gap: 6 }} accessibilityLabel={`${tr(label)}: ${tr(done ? "تم" : active ? "الآن" : "لاحقًا")}`}>
            <View style={{ flexDirection: "row-reverse", alignItems: "center", width: "100%" }}>
              <View style={{ flex: 1, height: 3, backgroundColor: i === 0 ? "transparent" : done || active ? t.primary : t.line }} />
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: done ? t.primary : active ? t.orange : t.line, alignItems: "center", justifyContent: "center" }}>
                {done ? <Check size={15} color={t.onPrimary} /> : <Txt weight="bold" style={{ color: active ? t.onAccent : t.muted, fontSize: 12, textAlign: "center" }}>{i + 1}</Txt>}
              </View>
              <View style={{ flex: 1, height: 3, backgroundColor: i === STEPS.length - 1 ? "transparent" : done ? t.primary : t.line }} />
            </View>
            <Txt weight={active ? "extra" : "medium"} style={{ fontSize: 12, textAlign: "center", color: active ? t.orange : done ? t.primary : t.muted }}>{tr(label)}</Txt>
          </View>
        );
      })}
    </View>
  );
}
