// "Follow us" buttons for the store's own Instagram and Facebook pages, set by the admin in the storefront settings.
// The server accepts only https links on the official hosts; the app checks the host again before opening one.
import React from "react";
import { Pressable, View } from "react-native";
import * as Linking from "expo-linking";
import { Txt } from "../ui";
import { FacebookGlyph, InstagramGlyph } from "./marks";
import { useStore } from "../../lib/store";
import { useI18n } from "../../lib/i18n";
import { useTheme } from "../../lib/theme";

const HOSTS = { instagram: ["instagram.com", "www.instagram.com"], facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com"] } as const;
export function safeSocialUrl(kind: keyof typeof HOSTS, value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  try { const url = new URL(value); return url.protocol === "https:" && (HOSTS[kind] as readonly string[]).includes(url.hostname) ? url.toString() : null; } catch { return null; }
}

export function SocialLinks({ compact = false }: { compact?: boolean }) {
  const { colors: t } = useTheme();
  const { t: tr } = useI18n();
  const { settings } = useStore();
  const links = [
    { kind: "instagram" as const, label: "تابعنا على إنستغرام", url: safeSocialUrl("instagram", settings.storefront?.instagram), Glyph: InstagramGlyph },
    { kind: "facebook" as const, label: "تابعنا على فيسبوك", url: safeSocialUrl("facebook", settings.storefront?.facebook), Glyph: FacebookGlyph },
  ].filter((l) => l.url);
  if (!links.length) return null;
  return (
    <View testID="social-links" style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 }}>
      {links.map(({ kind, label, url, Glyph }) => (
        <Pressable key={kind} testID={`social-${kind}`} accessibilityRole="link" accessibilityLabel={tr(label)} onPress={() => void Linking.openURL(url as string).catch(() => {})}
          style={({ pressed }) => ({ flexDirection: "row-reverse", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: compact ? 10 : 14, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: pressed ? t.secondary : t.paper })}>
          <Glyph size={18} color={t.ink} />
          {compact ? null : <Txt weight="medium" style={{ fontSize: 13 }}>{tr(label)}</Txt>}
        </Pressable>
      ))}
    </View>
  );
}
