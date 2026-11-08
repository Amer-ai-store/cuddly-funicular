import React, { useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { Button, Txt } from "../ui";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";

// The admin building blocks translate their own text, so the screens pass Arabic strings and English follows from
// the dictionary in src/lib/i18n-en.ts (strings it does not know, such as data from the server, stay as they are).
type Translate = (arabic: string, vars?: Record<string, string | number>) => string;

// Translates one piece of text while keeping the spaces and "·" separators around it, for lines that mix
// translated words with data: `{id} · المخزون {stock}` becomes `{id} · Stock {stock}`.
export function translateSegment(t: Translate, text: string) {
  const parts = text.match(/^([\s·]*)([\s\S]*?)([\s·]*)$/);
  return parts && parts[2] ? parts[1] + t(parts[2]) + parts[3] : text;
}

// A validation error whose message is a dictionary template, so it can be shown in either language.
export class AdminInputError extends Error {
  constructor(readonly template: string, readonly vars: Record<string, string>) {
    super(template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`));
  }
}

export function useDescribeError() {
  const { t } = useI18n();
  return (error: unknown, fallback = "تعذّر إتمام العملية. حاول مجددًا.") => {
    if (error instanceof AdminInputError) return t(error.template, Object.fromEntries(Object.entries(error.vars).map(([key, value]) => [key, t(value)])));
    return error instanceof Error && error.message ? t(error.message) : t(fallback);
  };
}

export function AdminCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors: c } = useTheme();
  const { t } = useI18n();
  return <View style={{ backgroundColor: c.paper, borderColor: c.line, borderWidth: 1, borderRadius: 18, padding: 18, gap: 13 }}>
    <Txt weight="bold" style={{ fontSize: 19 }}>{t(title)}</Txt>{children}
  </View>;
}

export function AdminField({ label, value, onChangeText, multiline = false, secret = false, numeric = false, placeholder }: {
  label: string; value: string; onChangeText: (text: string) => void; multiline?: boolean; secret?: boolean; numeric?: boolean; placeholder?: string;
}) {
  const { colors: c } = useTheme();
  const { t, isRTL } = useI18n();
  const text = t(label);
  return <View style={{ gap: 6, flexGrow: 1 }}>
    <Txt weight="medium" style={{ fontSize: 13, color: c.muted }}>{text}</Txt>
    <TextInput accessibilityLabel={text} value={value} onChangeText={onChangeText} placeholder={placeholder ? t(placeholder) : undefined} placeholderTextColor={c.muted}
      multiline={multiline} secureTextEntry={secret} autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? "decimal-pad" : "default"}
      style={{ backgroundColor: c.background, color: c.ink, borderColor: c.line, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, fontFamily: "Tajawal_400Regular", textAlign: isRTL ? "right" : "left", writingDirection: isRTL ? "rtl" : "ltr", minHeight: multiline ? 125 : 48, textAlignVertical: multiline ? "top" : "center" }} />
  </View>;
}

export function AdminChoices<T extends string>({ label, value, choices, onChange }: {
  label: string; value: T; choices: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  const { colors: c } = useTheme();
  const { t } = useI18n();
  const title = t(label);
  return <View style={{ gap: 8 }}><Txt style={{ color: c.muted, fontSize: 13 }}>{title}</Txt>
    <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 7 }}>{choices.map(item =>
      <Pressable key={item.value} accessibilityRole="button" aria-selected={value === item.value} accessibilityLabel={`${title}: ${t(item.label)}`}
        onPress={() => onChange(item.value)} style={{ backgroundColor: value === item.value ? c.orange : c.background, borderColor: c.line, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10, minHeight: 44, justifyContent: "center", borderRadius: 10 }}>
        <Txt weight="medium" style={{ color: value === item.value ? "white" : c.ink, fontSize: 13 }}>{t(item.label)}</Txt>
      </Pressable>)}</View>
  </View>;
}

export function AdminNotice({ error, message }: { error?: string; message?: string }) {
  const { colors: c } = useTheme();
  const { t } = useI18n();
  if (!error && !message) return null;
  return <View accessibilityLiveRegion="polite" style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: error ? "#CB5555" : c.green, backgroundColor: c.background }}>
    <Txt style={{ color: error ? "#CB5555" : c.green, lineHeight: 23 }}>{t(error || message || "")}</Txt>
  </View>;
}

export function AdminLoading() {
  const { colors: c } = useTheme();
  const { t } = useI18n();
  return <View style={{ padding: 24 }}><ActivityIndicator color={c.orange} accessibilityLabel={t("تحميل بيانات الإدارة")} /></View>;
}

export function AdminRefresh({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return <Button title="تحديث البيانات" busy={busy} secondary onPress={onPress} />;
}

export function useAdminAction() {
  const { t } = useI18n();
  const describe = useDescribeError();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const run = async (action: () => Promise<unknown>, success: string, after?: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); if (after) await after(); setMessage(t(success)); }
    catch (e) { setError(describe(e)); }
    finally { setBusy(false); }
  };
  return { busy, error, message, run, clear: () => { setError(""); setMessage(""); } };
}

export function numberInput(value: string, label: string) {
  const normalized = value.trim().replace(/[٠-٩]/g, n => String("٠١٢٣٤٥٦٧٨٩".indexOf(n))).replace(/[۰-۹]/g, n => String("۰۱۲۳۴۵۶۷۸۹".indexOf(n))).replace("٫", ".");
  const result = Number(normalized);
  if (!normalized || !Number.isFinite(result)) throw new AdminInputError("أدخل قيمة رقمية صحيحة لحقل {label}.", { label });
  return result;
}
