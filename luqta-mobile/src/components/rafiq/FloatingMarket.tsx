// "السوق العائم" from the Rafiq design, drawn in light vector graphics instead of a WebGL scene so it stays fast on
// phones: a floating island in a night sky, four pavilions for the store's main departments around a leaf-green core,
// and the shopper's character standing in the middle. Tapping a pavilion opens that department.
import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Line, Path, RadialGradient, Rect, Stop, LinearGradient } from "react-native-svg";
import { Txt } from "../ui";
import { useI18n } from "../../lib/i18n";
import { svgPath } from "../../lib/svgPath";

export type MarketStore = { id: string; name: string; nameEn: string; color: string };
type Kind = "terrace" | "tower" | "dome" | "tent";
const KINDS: Kind[] = ["terrace", "tower", "dome", "tent"];
const LEAF = "#B4F28A";
const GOLD = "#D8B878";

// Fixed star field (a tiny seeded generator, so the sky does not jump between renders).
function starField(count: number) {
  let seed = 7;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: count }, () => ({ x: next(), y: next() * 0.7, r: 0.5 + next() * 1.1, o: 0.25 + next() * 0.6 }));
}
const STARS = starField(46);

function Pavilion({ kind, x, y, s, color }: { kind: Kind; x: number; y: number; s: number; color: string }) {
  const w = 34 * s, h = 26 * s;
  return (
    <G>
      <Ellipse cx={x} cy={y + 2} rx={w * 0.75} ry={6 * s} fill="#000" opacity={0.35} />
      {kind === "terrace" ? (
        <>
          <Rect x={x - w / 2} y={y - h} width={w} height={h} rx={3} fill="#1A2236" stroke={color} strokeWidth={1} />
          <Path d={svgPath`M${x - w / 2 - 5 * s} ${y - h}L${x - w / 2} ${y - h - 10 * s}H${x + w / 2}L${x + w / 2 + 5 * s} ${y - h}Z`} fill={color} />
          {[0, 1, 2, 3].map((i) => {
            const left = x - w / 2 - 5 * s + i * ((w + 10 * s) / 4), sw = Math.max(4, (w + 10 * s) / 8), top = y - h, bottom = y - h + 5 * s;
            return <Path key={i} d={svgPath`M${left} ${top}L${left + sw} ${top}L${left + sw - 2} ${bottom}L${left + 2} ${bottom}Z`} fill="#FFFFFF" opacity={0.35} />;
          })}
          <Rect x={x - w / 4} y={y - h * 0.55} width={w / 2} height={h * 0.55} rx={2} fill={color} opacity={0.35} />
        </>
      ) : kind === "tower" ? (
        <>
          <Rect x={x - w / 3} y={y - h * 2.1} width={(w * 2) / 3} height={h * 2.1} rx={3} fill="#1A2236" stroke={color} strokeWidth={1} />
          {[0, 1, 2, 3].map((r) => [0, 1].map((c) => <Rect key={`${r}${c}`} x={x - w / 4 + c * (w / 4)} y={y - h * 1.9 + r * (h * 0.42)} width={w / 6} height={h * 0.2} rx={1} fill={LEAF} opacity={0.75 - r * 0.12} />))}
          <Line x1={x} y1={y - h * 2.1} x2={x} y2={y - h * 2.1 - 12 * s} stroke={color} strokeWidth={1.4} />
          <Circle cx={x} cy={y - h * 2.1 - 13 * s} r={2.2 * s} fill={LEAF} />
        </>
      ) : kind === "dome" ? (
        <>
          <Rect x={x - w / 2} y={y - h * 0.8} width={w} height={h * 0.8} rx={2} fill="#1A2236" stroke={color} strokeWidth={1} />
          <Path d={svgPath`M${x - w / 2} ${y - h * 0.8}A${w / 2} ${w / 2} 0 0 1 ${x + w / 2} ${y - h * 0.8}Z`} fill={color} opacity={0.85} />
          <Line x1={x} y1={y - h * 0.8 - w / 2} x2={x} y2={y - h * 0.8 - w / 2 - 8 * s} stroke={GOLD} strokeWidth={1.4} />
          <Circle cx={x} cy={y - h * 0.8 - w / 2 - 9 * s} r={2 * s} fill={GOLD} />
          <Path d={svgPath`M${x - 5 * s} ${y}L${x - 5 * s} ${y - h * 0.45}A${5 * s} ${5 * s} 0 0 1 ${x + 5 * s} ${y - h * 0.45}L${x + 5 * s} ${y}Z`} fill={LEAF} opacity={0.55} />
        </>
      ) : (
        <>
          <Path d={svgPath`M${x - w / 2 - 4 * s} ${y}L${x} ${y - h * 1.5}L${x + w / 2 + 4 * s} ${y}Z`} fill={color} opacity={0.9} />
          <Path d={svgPath`M${x} ${y - h * 1.5}L${x + w / 2 + 4 * s} ${y}H${x}Z`} fill="#000" opacity={0.18} />
          <Path d={svgPath`M${x - 6 * s} ${y}L${x} ${y - h * 0.7}L${x + 6 * s} ${y}Z`} fill="#0D1220" />
          <Circle cx={x} cy={y - h * 1.5 - 3 * s} r={2 * s} fill={GOLD} />
        </>
      )}
    </G>
  );
}

export function FloatingMarket({ stores, height = 300, onEnter, children }: { stores: MarketStore[]; height?: number; onEnter: (id: string) => void; children?: React.ReactNode }) {
  const { t: tr } = useI18n();
  const [width, setWidth] = useState(0);
  const [bob] = useState(() => new Animated.Value(0));
  const [still, setStill] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => { if (active) setStill(reduce); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (still) { bob.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [bob, still]);
  const [translateY] = useState(() => bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }));

  const layout = useMemo(() => {
    const cx = width / 2, cy = height * 0.6;
    const rx = Math.min(width * 0.44, 210), ry = rx * 0.3;
    // Back pair higher and smaller, front pair lower and larger: a little depth without 3D.
    // Back pavilions carry their label above, front ones below on the rock, so the four labels never overlap.
    const spots = [
      { x: cx - rx * 0.55, y: cy - ry * 0.35, s: 0.85, below: false },
      { x: cx + rx * 0.55, y: cy - ry * 0.35, s: 0.85, below: false },
      { x: cx - rx * 0.78, y: cy + ry * 0.45, s: 1.05, below: true },
      { x: cx + rx * 0.78, y: cy + ry * 0.45, s: 1.05, below: true },
    ];
    return { cx, cy, rx, ry, spots };
  }, [width, height]);
  const { cx, cy, rx, ry, spots } = layout;
  const shown = stores.slice(0, 4);

  return (
    <View testID="floating-market" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height, overflow: "hidden", backgroundColor: "#070A12" }}>
      {width > 0 ? (
        <>
          <Svg width={width} height={height} style={{ position: "absolute" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Defs>
              <RadialGradient id="sky" cx="50%" cy="20%" r="75%"><Stop offset="0" stopColor="#1B2A4A" stopOpacity={0.9} /><Stop offset="1" stopColor="#070A12" stopOpacity={0} /></RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={width} height={height} fill="url(#sky)" />
            {STARS.map((s, i) => <Circle key={i} cx={s.x * width} cy={s.y * height} r={s.r} fill="#DCE4FF" opacity={s.o} />)}
            <Circle cx={width * 0.14} cy={height * 0.2} r={16} fill="#131A2B" stroke={GOLD} strokeWidth={1} opacity={0.9} />
            <Ellipse cx={width * 0.14} cy={height * 0.2} rx={26} ry={6} fill="none" stroke={GOLD} strokeWidth={0.8} opacity={0.6} />
          </Svg>
          {/* Only the drawing floats; the labels and the character stay put, so they are easy to tap. */}
          <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height, transform: [{ translateY }] }}>
            <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {/* Gradients live in the drawing that uses them: on phones each Svg has its own definitions. */}
              <Defs>
                <RadialGradient id="fm-core" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={LEAF} stopOpacity={0.45} /><Stop offset="1" stopColor={LEAF} stopOpacity={0} /></RadialGradient>
                <LinearGradient id="fm-rock" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#1A2236" /><Stop offset="1" stopColor="#070A12" /></LinearGradient>
              </Defs>
              <Ellipse cx={cx} cy={cy} rx={rx * 1.12} ry={ry * 1.25} fill="none" stroke={GOLD} strokeWidth={0.8} strokeDasharray="3 6" opacity={0.55} />
              <Path d={svgPath`M${cx - rx} ${cy}C${cx - rx * 0.8} ${cy + ry * 2.2} ${cx - rx * 0.25} ${cy + ry * 3.4} ${cx} ${cy + ry * 3.9}C${cx + rx * 0.3} ${cy + ry * 3.3} ${cx + rx * 0.8} ${cy + ry * 2.1} ${cx + rx} ${cy}Z`} fill="url(#fm-rock)" />
              <Path d={svgPath`M${cx - rx * 0.6} ${cy + ry * 1.3}Q${cx} ${cy + ry * 1.8} ${cx + rx * 0.55} ${cy + ry * 1.2}M${cx - rx * 0.35} ${cy + ry * 2.4}Q${cx} ${cy + ry * 2.8} ${cx + rx * 0.3} ${cy + ry * 2.3}`} stroke="#2A3550" strokeWidth={1} fill="none" />
              <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#131A2B" stroke="rgba(214,224,255,0.18)" strokeWidth={1} />
              <Ellipse cx={cx} cy={cy - 1} rx={rx * 0.92} ry={ry * 0.82} fill={LEAF} opacity={0.06} />
              <Circle cx={cx} cy={cy - ry * 0.1} r={rx * 0.32} fill="url(#fm-core)" />
              <Ellipse cx={cx} cy={cy} rx={rx * 0.16} ry={ry * 0.22} fill="none" stroke={LEAF} strokeWidth={1.2} opacity={0.8} />
              <Ellipse cx={cx - rx * 1.05} cy={cy + ry * 2.6} rx={rx * 0.12} ry={ry * 0.18} fill="#131A2B" stroke="rgba(214,224,255,0.14)" />
              <Ellipse cx={cx + rx * 1.02} cy={cy - ry * 2.2} rx={rx * 0.08} ry={ry * 0.13} fill="#131A2B" stroke="rgba(214,224,255,0.14)" />
              {shown.map((store, i) => <Pavilion key={store.id} kind={KINDS[i]} x={spots[i].x} y={spots[i].y} s={spots[i].s * Math.min(1.15, Math.max(0.75, width / 400))} color={store.color} />)}
            </Svg>
          </Animated.View>
            {shown.map((store, i) => {
              const lift = KINDS[i] === "tower" ? 78 : KINDS[i] === "tent" ? 58 : 54;
              const top = spots[i].below ? spots[i].y + 10 : spots[i].y - lift * spots[i].s - 34;
              const left = Math.max(4, Math.min(width - 124, spots[i].x - 60));
              return (
                <Pressable key={store.id} testID={`market-store-${store.id}`} accessibilityRole="button" accessibilityLabel={tr("ادخل متجر {name}", { name: store.name })} onPress={() => onEnter(store.id)}
                  style={({ pressed }) => ({ position: "absolute", left, top, width: 120, alignItems: "center", transform: [{ scale: pressed ? 0.96 : 1 }] })}>
                  <View style={{ alignItems: "center", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: "rgba(9,13,24,0.8)", borderWidth: 1, borderColor: "rgba(214,224,255,0.18)" }}>
                    <Txt style={{ fontSize: 9, letterSpacing: 1, color: "#9BA4BA", textAlign: "center" }} numberOfLines={1}>{store.nameEn.toUpperCase()}</Txt>
                    <Txt weight="extra" style={{ fontSize: 12, color: "#E8ECF5", textAlign: "center" }} numberOfLines={1}>{store.name}</Txt>
                  </View>
                </Pressable>
              );
            })}
            {children ? <View pointerEvents="box-none" style={{ position: "absolute", left: cx - 60, top: cy - 120, width: 120, alignItems: "center" }}>{children}</View> : null}
          <View pointerEvents="none" style={{ position: "absolute", bottom: 10, left: 0, right: 0, alignItems: "center" }}>
            <View style={{ paddingHorizontal: 12, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(9,13,24,0.6)", borderWidth: 1, borderColor: "rgba(214,224,255,0.10)" }}>
              <Txt style={{ fontSize: 11, color: "#9BA4BA" }}>{tr("اضغط على متجر لدخوله")}</Txt>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}
