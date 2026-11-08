// Stylised city map (vector) used by the address and tracking screens, as in the
// reference designs. It is an illustration; real coordinates are shown as text and the
// live OpenStreetMap view is available from the order tracking details.
import React from "react";
import { View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { useTheme } from "../../lib/theme";

type Props = { height: number; route?: boolean; progress?: number; pin?: boolean };

export function MapArt({ height, route = false, progress = 0.5, pin = true }: Props) {
  const { colors: t, isDark } = useTheme();
  const land = isDark ? "#241C3E" : "#F1EEF8";
  const road = isDark ? "#352B57" : "#FFFFFF";
  const park = isDark ? "#27453A" : "#CFE8C9";
  const block = isDark ? "#2D2450" : "#E4DEF3";
  const W = 360, H = 200;
  const pathD = "M70 150 C 120 170, 150 120, 200 125 S 270 70, 300 55";
  const truck = { x: 70 + (300 - 70) * progress, y: 150 - (150 - 55) * progress };
  return (
    <View style={{ height, borderRadius: 24, overflow: "hidden", backgroundColor: land }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <Rect x="0" y="0" width={W} height={H} fill={land} />
        <G>
          {[[20, 20, 60, 40], [100, 15, 70, 35], [200, 25, 55, 45], [280, 10, 70, 30], [30, 90, 50, 50], [120, 80, 60, 30], [230, 95, 40, 40], [300, 110, 50, 60], [150, 150, 70, 40], [20, 160, 45, 35]].map(([x, y, w, h], i) => (
            <Rect key={i} x={x} y={y} width={w} height={h} rx="6" fill={block} />
          ))}
          <Rect x="250" y="140" width="60" height="45" rx="10" fill={park} />
          <Rect x="85" y="55" width="40" height="25" rx="8" fill={park} />
          <Rect x="320" y="20" width="35" height="40" rx="8" fill={isDark ? "#25365A" : "#C9DCF7"} />
        </G>
        {[["M0 70 L360 60", 9], ["M0 135 L360 150", 11], ["M90 0 L80 200", 10], ["M190 0 L215 200", 9], ["M285 0 L270 200", 8], ["M0 30 L360 0", 6], ["M30 200 L360 95", 7]].map(([d, w], i) => (
          <Path key={i} d={String(d)} stroke={road} strokeWidth={Number(w)} strokeLinecap="round" fill="none" />
        ))}
        {route ? <Path d={pathD} stroke={t.orange} strokeWidth="4" strokeDasharray="8 7" fill="none" strokeLinecap="round" /> : null}
        {route ? (
          <G>
            <Circle cx="70" cy="150" r="13" fill={t.orange} />
            <Rect x="63" y="146" width="14" height="10" rx="2" fill="#fff" />
            <Circle cx="300" cy="55" r="13" fill={t.orange} />
            <Path d="M293 57 L300 50 L307 57 L307 63 L293 63 Z" fill="#fff" />
            <G transform={`translate(${truck.x - 14} ${truck.y - 9})`}>
              <Rect x="0" y="0" width="18" height="13" rx="2" fill="#E5363D" />
              <Rect x="18" y="4" width="9" height="9" rx="2" fill="#FFFFFF" stroke="#C9C3D9" strokeWidth="1" />
              <Circle cx="6" cy="15" r="3" fill="#1F0A47" />
              <Circle cx="21" cy="15" r="3" fill="#1F0A47" />
            </G>
          </G>
        ) : null}
        {pin && !route ? (
          <G>
            <Circle cx={W / 2} cy={H / 2 + 22} r="16" fill={t.orange} opacity="0.18" />
            <Path d={`M${W / 2} ${H / 2 + 20} C ${W / 2 - 22} ${H / 2 - 4}, ${W / 2 - 20} ${H / 2 - 38}, ${W / 2} ${H / 2 - 38} C ${W / 2 + 20} ${H / 2 - 38}, ${W / 2 + 22} ${H / 2 - 4}, ${W / 2} ${H / 2 + 20} Z`} fill={t.orange} />
            <Circle cx={W / 2} cy={H / 2 - 14} r="8" fill="#fff" />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
