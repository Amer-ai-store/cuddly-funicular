// Small native charts (react-native-svg) in the Luqta palette — used by price history,
// Market Pulse and spending insights. RTL: time flows right → left like the designs.
import React, { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { Txt } from "../ui";
import { useTheme } from "../../lib/theme";

export function LineChart({ values, height = 150, color, labels, format = (v: number) => String(v), testID }: { values: number[]; height?: number; color?: string; labels?: [string, string]; format?: (v: number) => string; testID?: string }) {
  const { colors: t } = useTheme();
  const [w, setW] = useState(300);
  const c = color || t.orange;
  if (!values.length) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1, pad = 14;
  const xs = values.map((_, i) => (values.length === 1 ? w / 2 : w - pad - (i * (w - pad * 2)) / (values.length - 1)));
  const ys = values.map((v) => pad + (1 - (v - min) / span) * (height - pad * 2));
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${d} L${xs[xs.length - 1].toFixed(1)},${height} L${xs[0].toFixed(1)},${height} Z`;
  return (
    <View testID={testID} onLayout={(e) => setW(Math.max(120, e.nativeEvent.layout.width))} accessibilityLabel={`رسم بياني: من ${format(values[0])} إلى ${format(values[values.length - 1])}، الأدنى ${format(min)} والأعلى ${format(max)}`}>
      <Svg width={w} height={height}>
        <Defs><LinearGradient id="lc" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={c} stopOpacity={0.28} /><Stop offset="1" stopColor={c} stopOpacity={0} /></LinearGradient></Defs>
        <Line x1={0} x2={w} y1={height - 1} y2={height - 1} stroke={t.line} strokeWidth={1} />
        <Path d={area} fill="url(#lc)" />
        <Path d={d} stroke={c} strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={5} fill={c} stroke={t.card} strokeWidth={2} />
      </Svg>
      <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", marginTop: 4 }}>
        <Txt style={{ color: t.muted, fontSize: 12 }}>{labels?.[0] ?? ""}</Txt>
        <Txt weight="bold" style={{ color: t.title, fontSize: 12 }}>الأدنى {format(min)} · الأعلى {format(max)}</Txt>
        <Txt style={{ color: t.muted, fontSize: 12 }}>{labels?.[1] ?? ""}</Txt>
      </View>
    </View>
  );
}

export function Bars({ items, format = (v: number) => String(v), color }: { items: { label: string; value: number; hint?: string }[]; format?: (v: number) => string; color?: string }) {
  const { colors: t } = useTheme();
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <View style={{ gap: 10 }}>
      {items.map((i) => (
        <View key={i.label} accessibilityLabel={`${i.label}: ${format(i.value)}`}>
          <View style={{ flexDirection: "row-reverse", justifyContent: "space-between", marginBottom: 4 }}>
            <Txt weight="medium" style={{ color: t.ink }}>{i.label}</Txt>
            <Txt weight="bold" style={{ color: i.value < 0 ? t.green : t.title }}>{format(i.value)}{i.hint ? <Txt style={{ color: t.muted, fontSize: 12 }}> · {i.hint}</Txt> : null}</Txt>
          </View>
          <View style={{ height: 10, borderRadius: 6, backgroundColor: t.purpleSoft, overflow: "hidden", flexDirection: "row-reverse" }}>
            <View style={{ width: `${Math.max(3, (Math.abs(i.value) / max) * 100)}%`, backgroundColor: i.value < 0 ? t.green : color || t.orange, borderRadius: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ProgressBar({ value, color, height = 10 }: { value: number; color?: string; height?: number }) {
  const { colors: t } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }} style={{ height, borderRadius: height / 2, backgroundColor: t.purpleSoft, overflow: "hidden", flexDirection: "row-reverse" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color || t.orange, borderRadius: height / 2 }} />
    </View>
  );
}
