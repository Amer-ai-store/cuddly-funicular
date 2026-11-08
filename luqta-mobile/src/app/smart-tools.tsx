// "أدوات لُقطة الذكية" — hub for every feature merged from the أسواق جوافة / Aura app.
import React from "react";
import { View } from "react-native";
import { Shell } from "../components/Shell";
import { SectionHeader } from "../components/design/kit";
import { ToolGrid } from "../components/smart/Bits";
import { SMART_GROUPS } from "../components/smart/tools";
import { TOOL_FLAGS, useFlags } from "../lib/flags";


export default function SmartTools() {
  const flags = useFlags();
  return (
    <Shell title="أدوات لُقطة الذكية" subtitle="كل أدوات التوفير والاكتشاف في مكان واحد">
      {SMART_GROUPS.map((g) => (
        <View key={g.title} style={{ marginBottom: 18 }}>
          <SectionHeader title={g.title} />
          <ToolGrid tools={g.tools.filter((x) => !TOOL_FLAGS[x.key] || flags[TOOL_FLAGS[x.key]])} />
        </View>
      ))}
    </Shell>
  );
}
