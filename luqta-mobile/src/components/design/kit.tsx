// Design kit reproducing the Amer AI Store | لُقطة reference screens.
// Measurements are the reference pixels (853 px wide) divided by ~2.19.
import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { router } from "expo-router";
import { ArrowLeft, Camera, Check, ChevronLeft, ChevronRight, Info, Minus, Plus, RotateCcw, UserRound } from "lucide-react-native";
import { Palette, useTheme, useThemedStyles } from "../../lib/theme";
import { designAssets } from "../../lib/designAssets";
import { Txt } from "../ui";

export type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/** Header: logo (right) + "Amer AI Store", and a pill action on the left. */
export function BrandHeader({ left }: { left?: React.ReactNode }) {
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="لُقطة Amer AI Store — الرئيسية" onPress={() => router.navigate("/")} style={s.brand} testID="brand-logo">
        <Image source={designAssets.logoMark} style={s.logoMark} resizeMode="contain" />
        <View style={{ alignItems: "flex-end" }}>
          <Txt weight="extra" style={s.logoText}>لُقطة</Txt>
          <Txt weight="medium" style={s.logoSub}>Amer AI Store</Txt>
        </View>
      </Pressable>
      <View style={{ flex: 1 }} />
      {left === undefined ? <CharacterPill /> : left}
    </View>
  );
}

export function CharacterPill() {
  return <HeaderPill label="شخصيتي" icon={Camera} onPress={() => router.navigate("/robot")} testID="pill-character" />;
}
export function AccountPill() {
  return <HeaderPill label="حسابي" icon={UserRound} onPress={() => router.navigate("/profile")} testID="pill-account" />;
}
export function BackPill({ label = "العودة" }: { label?: string }) {
  return <HeaderPill label={label} icon={ChevronLeft} iconAfter onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} testID="pill-back" />;
}
export function BackSquare() {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="رجوع" testID="back" onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} style={s.backSquare}>
      <ArrowLeft size={24} color={t.ink} strokeWidth={2.3} />
    </Pressable>
  );
}

export function HeaderPill({ label, icon: Icon, onPress, iconAfter = false, testID }: { label: string; icon: IconType; onPress: () => void; iconAfter?: boolean; testID?: string }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ pressed }) => [s.pill, pressed && { opacity: 0.75 }]}>
      {iconAfter ? <Icon size={20} color={t.ink} strokeWidth={2.2} /> : null}
      <Txt weight="medium" style={{ fontSize: 15, color: t.ink }}>{label}</Txt>
      {!iconAfter ? <Icon size={21} color={t.ink} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}

/** Centered big title + muted subtitle, with optional character to the right. */
export function PageTitle({ title, subtitle, align = "center", side }: { title: string; subtitle?: string; align?: "center" | "right"; side?: React.ReactNode }) {
  const { colors: t } = useTheme();
  const centered = align === "center";
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", marginTop: 8, marginBottom: 12, minHeight: side ? 96 : undefined }}>
      {side ? <View style={{ marginLeft: 4 }}>{side}</View> : null}
      <View style={{ flex: 1, alignItems: centered ? "center" : "flex-end" }}>
        <Txt accessibilityRole="header" weight="extra" style={{ fontSize: 31, lineHeight: 44, color: t.title, textAlign: centered ? "center" : "right" }}>{title}</Txt>
        {subtitle ? <Txt style={{ fontSize: 16, lineHeight: 26, color: t.muted, textAlign: centered ? "center" : "right", marginTop: 2 }}>{subtitle}</Txt> : null}
      </View>
    </View>
  );
}

export function Card({ children, style, padded = true, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; testID?: string }) {
  const s = useThemedStyles(makeStyles);
  return <View testID={testID} style={[s.card, padded && { padding: 16 }, style]}>{children}</View>;
}

export type ChipTone = "demo" | "success" | "info" | "warn" | "neutral";
export function Chip({ label, tone = "demo", icon: Icon, dot }: { label: string; tone?: ChipTone; icon?: IconType; dot?: string }) {
  const { colors: t } = useTheme();
  const map: Record<ChipTone, [string, string]> = {
    demo: [t.chip, t.orange], success: [t.successSoft, t.green], info: [t.infoSoft, t.info], warn: [t.warnSoft, t.warn], neutral: [t.purpleSoft, t.muted],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 6, backgroundColor: bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start" }}>
      {dot ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: dot }} /> : null}
      {Icon ? <Icon size={15} color={fg} /> : null}
      <Txt weight="medium" style={{ color: fg, fontSize: 13 }}>{label}</Txt>
    </View>
  );
}

/** Big coral pill CTA with the chevron on the right as in the designs. */
export function CTA({ title, onPress, disabled = false, busy = false, icon: Icon, testID, style, tone = "primary" }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; icon?: IconType; testID?: string; style?: StyleProp<ViewStyle>; tone?: "primary" | "soft" }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const soft = tone === "soft";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [s.cta, soft && s.ctaSoft, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={soft ? t.orange : t.onAccent} /> : (
        <>
          <View style={{ width: 26 }}>{!Icon ? <ChevronRight size={26} color={soft ? t.orange : t.onAccent} strokeWidth={2.4} /> : null}</View>
          <View style={{ flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 10 }}>
            {Icon ? <Icon size={24} color={soft ? t.orange : t.onAccent} strokeWidth={2.2} /> : null}
            <Txt weight="bold" style={{ color: soft ? t.orange : t.onAccent, fontSize: 19, textAlign: "center" }}>{title}</Txt>
          </View>
          <View style={{ width: 26 }} />
        </>
      )}
    </Pressable>
  );
}

export function SmallButton({ title, onPress, icon: Icon, tone = "primary", disabled, testID, style }: { title: string; onPress: () => void; icon?: IconType; tone?: "primary" | "soft" | "outline" | "purple"; disabled?: boolean; testID?: string; style?: StyleProp<ViewStyle> }) {
  const { colors: t } = useTheme();
  const bg = tone === "primary" ? t.orange : tone === "soft" ? t.orangeSoft : tone === "purple" ? t.purpleSoft : t.card;
  const fg = tone === "primary" ? t.onAccent : tone === "soft" ? t.orange : t.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} testID={testID} onPress={onPress}
      style={({ pressed }) => [{ minHeight: 44, borderRadius: 999, paddingHorizontal: 16, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: bg, borderWidth: tone === "outline" ? 1 : 0, borderColor: t.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
      {Icon ? <Icon size={19} color={fg} strokeWidth={2.2} /> : null}
      <Txt weight="medium" style={{ color: fg, fontSize: 15 }}>{title}</Txt>
    </Pressable>
  );
}

/** "عرض الكل >" outline pill. */
export function SectionHeader({ title, action, onPress, icon: Icon }: { title: string; action?: string; onPress?: () => void; icon?: IconType }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", marginTop: 14, marginBottom: 10 }}>
      {Icon ? <Icon size={24} color={t.orange} strokeWidth={2.2} /> : null}
      <Txt accessibilityRole="header" weight="extra" style={{ fontSize: 21, color: t.title, marginRight: Icon ? 8 : 0 }}>{title}</Txt>
      <View style={{ flex: 1 }} />
      {action && onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onPress} style={s.outlinePill}>
          <Txt style={{ fontSize: 14, color: t.muted }}>{action}</Txt>
          <ChevronLeft size={17} color={t.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** "− 1 +" pill stepper (plus on the right). */
export function QtyStepper({ value, onChange, min = 1, max = 99, label, size = "md" }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string; size?: "md" | "sm" }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  const h = size === "sm" ? 38 : 46;
  const b = size === "sm" ? 30 : 38;
  return (
    <View style={[s.stepper, { height: h }]} accessibilityLabel={`${label}: ${value}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`زيادة كمية ${label}`} disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} style={[s.stepBtn, { width: b, height: b }, value >= max && { opacity: 0.35 }]} hitSlop={6}>
        <Plus size={22} color={t.ink} strokeWidth={2.3} />
      </Pressable>
      <Txt weight="bold" style={{ minWidth: size === "sm" ? 20 : 28, textAlign: "center", fontSize: size === "sm" ? 17 : 19, color: t.ink }}>{value}</Txt>
      <Pressable accessibilityRole="button" accessibilityLabel={`تقليل كمية ${label}`} disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} style={[s.stepBtn, { width: b, height: b }, value <= min && { opacity: 0.35 }]} hitSlop={6}>
        <Minus size={22} color={t.ink} strokeWidth={2.3} />
      </Pressable>
    </View>
  );
}

/** Segmented tabs (الحالية / السابقة / المرتجعات). */
export function Segmented<T extends string>({ options, value, onChange, testID }: { options: { value: T; label: string; icon?: IconType }[]; value: T; onChange: (v: T) => void; testID?: string }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.segmented} testID={testID} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={o.label} onPress={() => onChange(o.value)} style={[s.segment, active && { backgroundColor: t.orange }]}>
            {o.icon ? <o.icon size={22} color={active ? t.onAccent : t.purple} /> : null}
            <Txt weight="bold" style={{ fontSize: 17, color: active ? t.onAccent : t.ink }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function IconCircle({ icon: Icon, tint, bg, size = 44 }: { icon: IconType; tint?: string; bg?: string; size?: number }) {
  const { colors: t } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg || t.purpleSoft, alignItems: "center", justifyContent: "center" }}>
      <Icon size={size * 0.48} color={tint || t.purple} strokeWidth={2.2} />
    </View>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  return <TextInput accessibilityLabel={label} placeholderTextColor={t.mutedSoft} {...props} style={[s.field, style]} />;
}

/** Label on the right, control on the left (address form rows). */
export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors: t } = useTheme();
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 12, marginBottom: 10 }}>
      <Txt style={{ width: 82, color: t.muted, fontSize: 15 }}>{label}</Txt>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

export function Checkbox({ checked, onChange, label, testID }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; testID?: string }) {
  const { colors: t } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} testID={testID} onPress={() => onChange(!checked)} style={{ flexDirection: "row-reverse", alignItems: "center", gap: 12, minHeight: 44 }}>
      <View style={{ width: 28, height: 28, borderRadius: 7, borderWidth: 2, borderColor: checked ? t.orange : t.ink, backgroundColor: checked ? t.orange : "transparent", alignItems: "center", justifyContent: "center" }}>
        {checked ? <Check size={18} color={t.onAccent} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1 }}>{typeof label === "string" ? <Txt style={{ fontSize: 15, color: t.ink }}>{label}</Txt> : label}</View>
    </Pressable>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { colors: t } = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} hitSlop={8}
      style={{ width: 58, height: 32, borderRadius: 16, backgroundColor: value ? t.orange : t.line, padding: 3, justifyContent: "center" }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#fff", alignSelf: value ? "flex-end" : "flex-start", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 3, elevation: 2 }} />
    </Pressable>
  );
}

/** Horizontal slider (RTL: minimum on the right). */
export function Slider({ value, min, max, onChange, label, format }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; format: (v: number) => string }) {
  const { colors: t } = useTheme();
  const [width, setWidth] = React.useState(1);
  const ratio = (value - min) / (max - min);
  const update = (x: number) => { const r = Math.max(0, Math.min(1, 1 - x / width)); onChange(Math.round((min + r * (max - min)) * 100) / 100); };
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 12 }}>
      <Txt style={{ color: t.muted, fontSize: 15, width: 46 }}>{format(min)}</Txt>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: Math.round(min * 100), max: Math.round(max * 100), now: Math.round(value * 100), text: format(value) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => onChange(Math.max(min, Math.min(max, value + (e.nativeEvent.actionName === "increment" ? 0.05 : -0.05))))}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width || 1)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => update(e.nativeEvent.locationX)}
        onResponderMove={(e) => update(e.nativeEvent.locationX)}
        style={{ flex: 1, height: 36, justifyContent: "center" }}
      >
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.line }} />
        <View style={{ position: "absolute", right: 0, width: `${ratio * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.orange, opacity: 0.85 }} />
        <View style={{ position: "absolute", right: `${ratio * 100}%`, marginRight: -14, width: 28, height: 28, borderRadius: 14, backgroundColor: t.orange, borderWidth: 4, borderColor: "#fff", shadowColor: t.shadow, shadowOpacity: 0.25, shadowRadius: 5, elevation: 3 }} />
      </View>
      <Txt style={{ color: t.muted, fontSize: 15, width: 46, textAlign: "left" }}>{format(max)}</Txt>
    </View>
  );
}

export function RadioDot({ selected }: { selected: boolean }) {
  const { colors: t } = useTheme();
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: selected ? t.orange : t.mutedSoft, alignItems: "center", justifyContent: "center" }}>
      {selected ? <View style={{ width: 15, height: 15, borderRadius: 8, backgroundColor: t.orange }} /> : null}
    </View>
  );
}

/** "ⓘ note" muted line. */
export function InfoNote({ text, tone = "muted" }: { text: string; tone?: "muted" | "warn" }) {
  const { colors: t } = useTheme();
  const c = tone === "warn" ? t.warn : t.muted;
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: 7 }}>
      <Info size={18} color={c} />
      <Txt style={{ color: c, fontSize: 14, flexShrink: 1 }}>{text}</Txt>
    </View>
  );
}

export function LoadingBlock({ label = "جارٍ التحميل…" }: { label?: string }) {
  const { colors: t } = useTheme();
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 28, alignItems: "center", gap: 12 }}>
      <ActivityIndicator color={t.orange} size="large" />
      <Txt style={{ color: t.muted }}>{label}</Txt>
    </View>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors: t } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ padding: 16, borderRadius: 16, backgroundColor: t.orangeSoft, gap: 10, borderWidth: 1, borderColor: t.chip }}>
      <Txt weight="bold" style={{ color: t.danger }}>{message}</Txt>
      {onRetry ? <SmallButton title="إعادة المحاولة" icon={RotateCcw} tone="soft" onPress={onRetry} style={{ alignSelf: "flex-end" }} /> : null}
    </View>
  );
}

/** Menu row used by the account screen. */
export function MenuRow({ title, subtitle, icon, onPress, testID }: { title: string; subtitle: string; icon: IconType; onPress: () => void; testID?: string }) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} testID={testID} onPress={onPress} style={({ pressed }) => [s.card, s.menuRow, pressed && { opacity: 0.8 }]}>
      <IconCircle icon={icon} size={58} />
      <View style={{ flex: 1, marginRight: 14 }}>
        <Txt weight="bold" style={{ fontSize: 18, color: t.title }}>{title}</Txt>
        <Txt style={{ fontSize: 14, color: t.muted, marginTop: 3 }}>{subtitle}</Txt>
      </View>
      <ChevronLeft size={26} color={t.muted} />
    </Pressable>
  );
}

const makeStyles = (t: Palette) => StyleSheet.create({
  header: { flexDirection: "row-reverse", alignItems: "center", paddingTop: 6, minHeight: 66 },
  brand: { flexDirection: "row-reverse", alignItems: "center", gap: 6, minHeight: 48 },
  logoMark: { width: 58, height: 60 },
  logoText: { fontSize: 33, lineHeight: 40, color: t.title, textAlign: "right" },
  logoSub: { fontSize: 13, lineHeight: 16, color: t.ink, textAlign: "right", marginTop: -2 },
  pill: { flexDirection: "row-reverse", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.card },
  backSquare: { width: 48, height: 48, borderRadius: 16, borderWidth: 1, borderColor: t.line, backgroundColor: t.purpleSoft, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: t.card, borderRadius: 22, borderWidth: 1, borderColor: t.line, shadowColor: t.shadow, shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  cta: { minHeight: 54, borderRadius: 999, backgroundColor: t.orange, flexDirection: "row", alignItems: "center", paddingHorizontal: 18, shadowColor: t.orange, shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  ctaSoft: { backgroundColor: t.orangeSoft, borderWidth: 1, borderColor: t.chip, shadowOpacity: 0, elevation: 0 },
  outlinePill: { flexDirection: "row-reverse", alignItems: "center", gap: 4, minHeight: 38, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: t.line, backgroundColor: t.card },
  stepper: { flexDirection: "row-reverse", alignItems: "center", borderRadius: 999, backgroundColor: t.field, borderWidth: 1, borderColor: t.line, paddingHorizontal: 6, gap: 4, alignSelf: "flex-start" },
  stepBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  segmented: { flexDirection: "row-reverse", backgroundColor: t.card, borderRadius: 999, borderWidth: 1, borderColor: t.line, padding: 4 },
  segment: { flex: 1, minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", flexDirection: "row-reverse", gap: 8 },
  field: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.field, paddingHorizontal: 14, color: t.ink, fontFamily: "Tajawal_500Medium", fontSize: 15, textAlign: "right", writingDirection: "rtl" },
  menuRow: { flexDirection: "row-reverse", alignItems: "center", padding: 14, marginBottom: 10 },
});
