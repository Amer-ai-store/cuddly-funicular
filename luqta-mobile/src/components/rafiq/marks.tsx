// Small vector marks for the Rafiq design: the brand mark (gold orbit, leaf ring and core), the three companions'
// faces, and the glyphs used on the store's Instagram and Facebook links.
import React from "react";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import type { CompanionId } from "../../lib/rafiq";

const LEAF = "#B4F28A";
const GOLD = "#D8B878";

export function RafiqMark({ size = 38, leaf = LEAF, gold = GOLD }: { size?: number; leaf?: string; gold?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 38 38" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={19} cy={19} r={17} fill="none" stroke={gold} strokeWidth={1} />
      <Circle cx={19} cy={19} r={10} fill="none" stroke={leaf} strokeWidth={1.4} />
      <Circle cx={19} cy={19} r={3.2} fill={leaf} />
      <Circle cx={31} cy={11} r={1.6} fill={gold} />
    </Svg>
  );
}

/** The companion's face: Nira a glowing jellyfish, Orion a pearl figure, Silk a crystal with gold shards. */
export function CompanionFace({ id, size = 40 }: { id: CompanionId; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {id === "nira" ? (
        <>
          <Path d="M8 20c0-7 5-12 12-12s12 5 12 12c-3 1-6 1-12 1s-9 0-12-1z" fill="rgba(180,242,138,0.18)" stroke="#CFF7E0" strokeWidth={1.2} />
          <Circle cx={20} cy={16} r={3} fill={LEAF} />
          <Path d="M12 22c0 4 2 6 1 10M17 22c0 5 1 7 0 12M23 22c0 5-1 7 0 12M28 22c0 4-2 6-1 10" fill="none" stroke={LEAF} strokeWidth={1} strokeLinecap="round" opacity={0.8} />
        </>
      ) : id === "orion" ? (
        <>
          <Ellipse cx={20} cy={10} rx={5} ry={6} fill="#F1F2F7" />
          <Rect x={16} y={9.2} width={8} height={1.6} rx={0.8} fill={LEAF} />
          <Ellipse cx={20} cy={26} rx={8} ry={10} fill="#F1F2F7" />
          <Path d="M12.2 26h15.6" stroke={LEAF} strokeWidth={1.2} />
          <Circle cx={8} cy={25} r={2} fill="#F1F2F7" />
          <Circle cx={32} cy={25} r={2} fill="#F1F2F7" />
        </>
      ) : (
        <>
          <Path d="M20 5l12 7v14l-12 7-12-7V12z" fill="rgba(230,243,255,0.08)" stroke="#E6F3FF" strokeWidth={1} />
          <Path d="M20 12l5 7-5 7-5-7z" fill={LEAF} />
          <Path d="M6 8l3 2M34 30l-3-2M33 8l-2 3" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

export function InstagramGlyph({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={3} y={3} width={18} height={18} rx={5} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={12} cy={12} r={4} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={17.3} cy={6.7} r={1.2} fill={color} />
    </Svg>
  );
}

export function FacebookGlyph({ size = 20, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={12} cy={12} r={9.5} fill="none" stroke={color} strokeWidth={2} />
      <Path d="M13.4 21.4v-7.3h2.4l.4-2.8h-2.8V9.5c0-.8.3-1.4 1.4-1.4h1.5V5.6c-.3 0-1.1-.1-2.1-.1-2.1 0-3.4 1.2-3.4 3.5v2.3H8.4v2.8h2.4v7.3" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}
