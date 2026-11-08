import React from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, TextInputProps, TextProps, View, ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Minus, Plus, Sparkles } from "lucide-react-native";
import { router } from "expo-router";
import { Palette, useTheme, useThemedStyles } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export function Txt({ weight = "regular", style, children, ...props }: TextProps & { weight?: "regular" | "medium" | "bold" | "extra" }) {
  const { colors: t, fonts } = useTheme();
  const { align, isRTL, lang, t: tr } = useI18n();
  const font = fonts[weight];
  // Plain Arabic text written straight in a screen is looked up in the English dictionary too (Arabic stays as the
  // fallback), so screens that do not call t() themselves still switch language.
  const content = lang === "en" && typeof children === "string" ? tr(children) : children;
  return <Text {...props} style={[{ fontFamily: font, color: t.ink, textAlign: align, writingDirection: isRTL ? "rtl" : "ltr", fontSize: 15 }, style]}>{content}</Text>;
}

export function Button({ title, onPress, secondary = false, disabled = false, busy = false, style, icon, tone = "accent", testID }: {
  title: string; onPress: () => void; secondary?: boolean; disabled?: boolean; busy?: boolean; style?: ViewStyle; icon?: React.ReactNode; tone?: "accent" | "primary" | "danger"; testID?: string;
}) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const s = useThemedStyles(makeStyles);
  // Titles go through the translator here, so staff screens can pass their Arabic text as-is.
  const label = tr(title);
  const background = secondary ? t.secondary : tone === "primary" ? t.primary : tone === "danger" ? t.danger : t.orange;
  const color = secondary ? t.ink : tone === "primary" ? t.onPrimary : t.onAccent;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} aria-disabled={disabled || busy} aria-busy={busy} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [s.button, { backgroundColor: background, opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}>
      {busy ? <ActivityIndicator color={color} /> : <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 8 }}>{icon}<Txt weight="bold" style={{ color, textAlign: "center", fontSize: 16 }}>{label}</Txt></View>}
    </Pressable>
  );
}

export function EmptyState({ title, detail, action = "اكتشف المنتجات", href = "/explore", art }: { title: string; detail: string; action?: string; href?: string; art?: React.ReactNode }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.empty}>
      {art ?? <View style={s.emptyIcon}><Sparkles color={t.orange} size={30} /></View>}
      <Txt accessibilityRole="header" weight="bold" style={{ fontSize: 22, textAlign: "center" }}>{tr(title)}</Txt>
      <Txt style={{ color: t.muted, textAlign: "center", lineHeight: 26, maxWidth: 340 }}>{tr(detail)}</Txt>
      {action ? <Button title={tr(action)} onPress={() => router.navigate(href as never)} style={{ minWidth: 180 }} /> : null}
    </View>
  );
}

export function SectionTitle({ title, subtitle, action, onPress }: { title: string; subtitle?: string; action?: string; onPress?: () => void }) {
  const { colors: t } = useTheme();
  const { t: tr, isRTL } = useI18n();
  const s = useThemedStyles(makeStyles);
  const Arrow = isRTL ? ArrowLeft : ArrowRight;
  return (
    <View style={s.section}>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt accessibilityRole="header" weight="extra" style={{ fontSize: 21 }}>{tr(title)}</Txt>
        {subtitle ? <Txt style={{ color: t.muted, fontSize: 13 }}>{tr(subtitle)}</Txt> : null}
      </View>
      {action && onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={tr(action)} onPress={onPress} style={s.link}>
          <Txt weight="bold" style={{ color: t.primary, fontSize: 13 }}>{tr(action)}</Txt>
          <Arrow color={t.primary} size={15} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({ children, style, tone = "paper", onPress, testID, accessibilityLabel }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[]; tone?: "paper" | "soft" | "primary" | "accent"; onPress?: () => void; testID?: string; accessibilityLabel?: string }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const background = { paper: t.paper, soft: t.secondary, primary: t.primary, accent: t.orange }[tone];
  const content = [s.card, { backgroundColor: background, borderColor: tone === "paper" ? t.line : "transparent" }, style];
  if (!onPress) return <View testID={testID} style={content}>{children}</View>;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [...content, { opacity: pressed ? 0.9 : 1 }]}>{children}</Pressable>;
}

export function Chip({ label, active = false, onPress, icon, testID, tone = "primary" }: { label: string; active?: boolean; onPress?: () => void; icon?: React.ReactNode; testID?: string; tone?: "primary" | "accent" }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const on = tone === "accent" ? t.orange : t.primary;
  return (
    <Pressable testID={testID} accessibilityRole="button" aria-selected={active} accessibilityLabel={tr(label)} onPress={onPress} disabled={!onPress}
      style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? on : t.paper, borderWidth: 1, borderColor: active ? on : t.line }}>
      {icon}
      <Txt weight={active ? "bold" : "medium"} style={{ color: active ? (tone === "accent" ? t.onAccent : t.onPrimary) : t.ink, fontSize: 13 }}>{tr(label)}</Txt>
    </Pressable>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, testID }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; testID?: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <View testID={testID} accessibilityRole="tablist" style={{ flexDirection: "row-reverse", backgroundColor: t.secondary, borderRadius: 999, padding: 4, gap: 4 }}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <Pressable key={tab.id} accessibilityRole="tab" aria-selected={active} accessibilityLabel={tr(tab.label)} onPress={() => onChange(tab.id)}
            style={{ flex: 1, minHeight: 40, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: active ? t.paper : "transparent", flexDirection: "row-reverse", gap: 6, paddingHorizontal: 6 }}>
            <Txt weight={active ? "bold" : "medium"} style={{ fontSize: 13, color: active ? t.primary : t.muted, textAlign: "center" }} numberOfLines={1}>{tr(tab.label)}</Txt>
            {tab.count ? <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: active ? t.primary : t.line, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><Txt style={{ fontSize: 11, color: active ? t.onPrimary : t.ink }}>{tab.count}</Txt></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, label, testID }: { value: number; onChange: (value: number) => void; min?: number; max?: number; label?: string; testID?: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const button = (delta: number, Icon: typeof Plus, name: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${tr(name)}${label ? ` ${label}` : ""}`} disabled={delta < 0 ? value <= min : value >= max} onPress={() => onChange(Math.min(max, Math.max(min, value + delta)))}
      style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: delta > 0 ? t.primary : t.paper, alignItems: "center", justifyContent: "center", opacity: (delta < 0 ? value <= min : value >= max) ? 0.4 : 1, borderWidth: delta > 0 ? 0 : 1, borderColor: t.line }}>
      <Icon size={16} color={delta > 0 ? t.onPrimary : t.ink} />
    </Pressable>
  );
  return (
    <View testID={testID} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 10, backgroundColor: t.secondary, borderRadius: 999, padding: 3 }}>
      {button(1, Plus, "زيادة")}
      <Txt weight="extra" style={{ minWidth: 22, textAlign: "center", fontSize: 16 }} accessibilityLabel={`${tr("الكمية")} ${value}`}>{value}</Txt>
      {button(-1, Minus, "إنقاص")}
    </View>
  );
}

export function IconButton({ icon, label, onPress, badge, tone = "paper", testID, size = 44 }: { icon: React.ReactNode; label: string; onPress: () => void; badge?: number; tone?: "paper" | "soft" | "primary" | "accent"; testID?: string; size?: number }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const background = { paper: t.paper, soft: t.secondary, primary: t.primary, accent: t.orange }[tone];
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={tr(label)} onPress={onPress} hitSlop={4}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: background, alignItems: "center", justifyContent: "center", borderWidth: tone === "paper" ? 1 : 0, borderColor: t.line, opacity: pressed ? 0.8 : 1 })}>
      {icon}
      {badge ? <View style={{ position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.orange, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}><Txt style={{ color: t.onAccent, fontSize: 10, textAlign: "center" }}>{badge > 99 ? "99+" : badge}</Txt></View> : null}
    </Pressable>
  );
}

export function ListRow({ icon, title, detail, onPress, trailing, danger = false, testID }: { icon?: React.ReactNode; title: string; detail?: string; onPress?: () => void; trailing?: React.ReactNode; danger?: boolean; testID?: string }) {
  const { colors: t } = useTheme();
  const { t: tr, isRTL } = useI18n();
  const Chevron = isRTL ? ChevronLeft : ChevronRight;
  return (
    <Pressable testID={testID} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={tr(title)} onPress={onPress} disabled={!onPress}
      style={({ pressed }) => ({ flexDirection: "row-reverse", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 10, opacity: pressed ? 0.75 : 1 })}>
      {icon ? <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: danger ? t.orangeSoft : t.primarySoft, alignItems: "center", justifyContent: "center" }}>{icon}</View> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="bold" style={{ fontSize: 15, color: danger ? t.danger : t.ink }}>{tr(title)}</Txt>
        {detail ? <Txt style={{ color: t.muted, fontSize: 12 }}>{tr(detail)}</Txt> : null}
      </View>
      {trailing ?? (onPress ? <Chevron size={18} color={t.muted} /> : null)}
    </Pressable>
  );
}

export function Toggle({ value, onChange, label, detail, testID }: { value: boolean; onChange: (value: boolean) => void; label: string; detail?: string; testID?: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable testID={testID} accessibilityRole="switch" aria-checked={value} accessibilityLabel={tr(label)} onPress={() => onChange(!value)} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 12, minHeight: 52 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="bold" style={{ fontSize: 14 }}>{tr(label)}</Txt>
        {detail ? <Txt style={{ fontSize: 12, color: t.muted }}>{tr(detail)}</Txt> : null}
      </View>
      <View style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: value ? t.primary : t.line, padding: 3, alignItems: value ? "flex-start" : "flex-end" }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#FFFFFF" }} />
      </View>
    </Pressable>
  );
}

export function Field({ label, style, testID, ...props }: TextInputProps & { label: string; testID?: string }) {
  const { colors: t } = useTheme();
  const { t: tr, align } = useI18n();
  return (
    <View style={{ gap: 6 }}>
      <Txt weight="bold" style={{ fontSize: 13, color: t.muted }}>{tr(label)}</Txt>
      <TextInput testID={testID} accessibilityLabel={tr(label)} placeholderTextColor={t.muted} {...props}
        style={[{ minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: t.line, backgroundColor: t.paper, color: t.ink, paddingHorizontal: 14, fontFamily: "Tajawal_500Medium", fontSize: 15, textAlign: align }, props.multiline ? { minHeight: 96, paddingTop: 12, textAlignVertical: "top" } : null, style]} />
    </View>
  );
}

export function Badge({ label, tone = "primary" }: { label: string; tone?: "primary" | "accent" | "success" | "warning" | "danger" | "muted" }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const map = { primary: [t.primarySoft, t.primary], accent: [t.orangeSoft, t.orange], success: [t.successSoft, t.success], warning: [t.warningSoft, t.warning], danger: [t.orangeSoft, t.danger], muted: [t.secondary, t.muted] }[tone];
  return <View style={{ alignSelf: "flex-start", backgroundColor: map[0], borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}><Txt weight="bold" style={{ color: map[1], fontSize: 11 }}>{tr(label)}</Txt></View>;
}

export function ProgressRing({ value, size = 92, stroke = 10, label, sublabel }: { value: number; size?: number; stroke?: number; label?: string; sublabel?: string }) {
  const { colors: t } = useTheme();
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.line} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.orange} strokeWidth={stroke} fill="none" strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
      {label ? <Txt weight="extra" style={{ fontSize: size / 4.4, textAlign: "center" }}>{label}</Txt> : null}
      {sublabel ? <Txt style={{ fontSize: 10, color: t.muted, textAlign: "center" }}>{sublabel}</Txt> : null}
    </View>
  );
}

export function Notice({ text, tone = "primary" }: { text: string; tone?: "primary" | "accent" | "success" | "warning" | "danger" }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const map = { primary: [t.primarySoft, t.primary], accent: [t.orangeSoft, t.orange], success: [t.successSoft, t.success], warning: [t.warningSoft, t.warning], danger: [t.orangeSoft, t.danger] }[tone];
  return <View accessibilityLiveRegion="polite" style={{ backgroundColor: map[0], borderRadius: 16, padding: 12 }}><Txt weight="medium" style={{ color: map[1], fontSize: 13, lineHeight: 21 }}>{tr(text)}</Txt></View>;
}

export function Row({ children, gap = 10, style, wrap = false }: { children: React.ReactNode; gap?: number; style?: ViewStyle; wrap?: boolean }) {
  return <View style={[{ flexDirection: "row-reverse", alignItems: "center", gap, flexWrap: wrap ? "wrap" : "nowrap" }, style]}>{children}</View>;
}

export function KeyValue({ label, value, strong = false, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  return (
    <View testID={testID} style={{ flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, gap: 12 }}>
      <Txt style={{ color: strong ? t.ink : t.muted, fontSize: strong ? 16 : 14 }} weight={strong ? "extra" : "regular"}>{tr(label)}</Txt>
      <Txt weight={strong ? "extra" : "bold"} style={{ fontSize: strong ? 17 : 14 }}>{value}</Txt>
    </View>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  button: { paddingHorizontal: 22, paddingVertical: 14, borderRadius: 18, alignItems: "center", justifyContent: "center", minHeight: 52 },
  empty: { alignItems: "center", padding: 36, gap: 16 },
  emptyIcon: { width: 70, height: 70, borderRadius: 24, backgroundColor: t.orangeSoft, alignItems: "center", justifyContent: "center" },
  section: { flexDirection: "row-reverse", alignItems: "center", gap: 16, marginTop: 24, marginBottom: 14 },
  link: { flexDirection: "row-reverse", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 4 },
  card: { borderRadius: 24, padding: 16, borderWidth: 1, shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 1 },
});

/** A compact figure with its label (distance, delivery time, item counts), used in rows of two to four. */
export function StatTile({ label, value, icon, tone = "primary", testID }: { label: string; value: string; icon?: React.ReactNode; tone?: "primary" | "accent" | "success" | "warning"; testID?: string }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const soft = { primary: t.primarySoft, accent: t.orangeSoft, success: t.successSoft, warning: t.warningSoft }[tone];
  const ink = { primary: t.primary, accent: t.orange, success: t.success, warning: t.warning }[tone];
  return (
    <View testID={testID} style={{ flex: 1, minWidth: 96, gap: 6, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: t.line, backgroundColor: t.paper }}>
      {icon ? <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: soft, alignItems: "center", justifyContent: "center" }}>{icon}</View> : null}
      <Txt weight="extra" style={{ fontSize: 18, color: ink }} numberOfLines={1}>{value}</Txt>
      <Txt style={{ fontSize: 11, color: t.muted }} numberOfLines={1}>{tr(label)}</Txt>
    </View>
  );
}

/** A soft pulsing placeholder shown while content loads, instead of a bare spinner. */
export function Skeleton({ height = 16, width = "100%", radius = 10, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: ViewStyle }) {
  const { colors: t } = useTheme();
  const [pulse] = React.useState(() => new Animated.Value(0.45));
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ height, width, borderRadius: radius, backgroundColor: t.secondary, opacity: pulse }, style]} />;
}
